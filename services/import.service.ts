import "server-only";
import type { AmountMode, ImportRowStatus, Prisma, SourceType, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { toDecimal } from "@/lib/money";
import { saveFile, sha256 } from "@/lib/storage";
import { classifyImported, detectInstitution, extractReference } from "@/lib/import/classify";
import { detectFileKind, extractPdfLines, MAX_UPLOAD_BYTES, parseCsv, parseXlsx, PdfPasswordError, type FileKind } from "@/lib/import/files";
import { parseStatementLines } from "@/lib/import/pdf-statement";
import {
  detectDateFormat,
  findHeaderRow,
  headerSignature,
  isZeroAmount,
  parseAmount,
  parseDateWith,
  suggestAmountMode,
  suggestMapping,
  type ColumnMapping,
  type DateFormat,
  type MappingField,
} from "@/lib/import/values";
import { columnMappingSchema, importAccountSchema, importRowUpdateSchema, type ColumnMappingData } from "@/validators/imports";
import { assertCategory } from "@/services/category.service";
import { loadRulesForMatching } from "@/services/rule.service";
import { collectAffected, emptyAffected, lockForWrite, recomputeAffected, type AffectedAccounts } from "@/services/ledger-balance.service";
import {
  attachToExisting,
  createIngestedTransaction,
  detachSource,
  findDuplicate,
  promoteDuplicatesOf,
  revertFill,
  merchantFor,
  resolvePaidCard,
  statementFingerprint,
  STATEMENT_SOURCES,
  suggestCategory,
  type AccountRef,
  type IngestRow,
  type SourceFillMeta,
} from "@/services/ingestion.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

export const MAX_IMPORT_ROWS = 5000;
const LONG_TX = { timeout: 180_000, maxWait: 15_000 };
/** Rows below this confidence are imported as "pending review" (not counted until approved). */
export const REVIEW_CONFIDENCE = 80;

const SOURCE_OF: Record<FileKind, SourceType> = { CSV: "CSV", XLSX: "XLSX", PDF: "PDF" };

// ───────────────────────────── helpers ─────────────────────────────

function accountOfImport(imp: { bankAccountId: string | null; creditCardId: string | null }): AccountRef {
  if (imp.bankAccountId) return { kind: "bank", id: imp.bankAccountId };
  if (imp.creditCardId) return { kind: "card", id: imp.creditCardId };
  throw new AppError("This import's account was removed. Cancel it and upload again.", 409, "ACCOUNT_MISSING");
}

async function findOwnedImport(db: Tx | typeof prisma, userId: string, id: string) {
  assertIds(id);
  const imp = await db.transactionImport.findFirst({ where: { id, userId } });
  if (!imp) throw new NotFoundError("Import not found.");
  return imp;
}

async function lockImport(tx: Tx, id: string) {
  assertIds(id);
  await tx.$queryRaw`SELECT id FROM "transaction_imports" WHERE id = ${id} FOR UPDATE`;
}

function assertStatus(imp: { status: string }, allowed: string[], message: string) {
  if (!allowed.includes(imp.status)) throw new AppError(message, 409, "IMPORT_STATE");
}

type StoredMapping = { fields: ColumnMapping; positiveIs: "CREDIT" | "DEBIT"; headers?: string[] };

// ───────────────────────────── upload ─────────────────────────────

export type UploadInput = { file: { name: string; type: string; buffer: Buffer }; account: unknown; password?: string | null };

/**
 * Stores the file privately, parses it and creates the import in either
 * AWAITING_MAPPING (CSV/XLSX — user confirms the columns) or AWAITING_REVIEW (PDF).
 * Nothing touches the ledger until `commitImport`.
 */
export async function createImport(userId: string, input: UploadInput, meta: RequestMeta = NO_META) {
  const accountStr = parseOrThrow(importAccountSchema, input.account);
  const [kind, id] = accountStr.split(":") as ["bank" | "card", string];
  const owned =
    kind === "bank"
      ? await prisma.bankAccount.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } })
      : await prisma.creditCard.findFirst({ where: { id, userId, deletedAt: null }, select: { id: true } });
  if (!owned) throw new AppError("Choose one of your accounts.", 400, "INVALID_ACCOUNT", { account: ["Choose one of your accounts"] });

  const { buffer, name } = input.file;
  if (!buffer.length) throw new AppError("The file is empty.", 400, "EMPTY_FILE");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  const fileKind = detectFileKind(buffer, name);
  if (!fileKind) {
    throw new AppError(
      /\.xls$/i.test(name) ? "Old Excel (.xls) files aren't supported — open it and save as .xlsx or CSV." : "Upload a CSV, XLSX or PDF statement.",
      415,
      "UNSUPPORTED_FILE",
    );
  }
  const safeName = name.replace(/[^\w.\- ()]/g, "_").slice(-120) || `statement.${fileKind.toLowerCase()}`;
  const hash = sha256(buffer);
  const previous = await prisma.transactionImport.findFirst({
    where: { userId, fileSha256: hash, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  // Parse BEFORE storing so a wrong password / unreadable file leaves nothing behind.
  let rawRows: string[][] = [];
  let pdf: ReturnType<typeof parseStatementLines> | null = null;
  let institutionText = "";
  if (fileKind === "PDF") {
    let lines: string[];
    try {
      ({ lines } = await extractPdfLines(buffer, input.password ?? undefined));
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        throw new AppError(
          e.incorrect ? "That password didn't open the PDF." : "This PDF is password protected. Enter its password (it is used once and never stored).",
          422,
          e.incorrect ? "PDF_PASSWORD_INCORRECT" : "PDF_PASSWORD_REQUIRED",
          { password: [e.incorrect ? "Incorrect password" : "Password required"] },
        );
      }
      throw new AppError("This PDF couldn't be read. Try downloading the statement again or use CSV/XLSX.", 422, "PDF_UNREADABLE");
    }
    if (!lines.some((l) => l.trim())) {
      throw new AppError("This PDF has no text layer (it's a scanned image). Download a text PDF, CSV or XLSX from your bank instead.", 422, "PDF_NO_TEXT");
    }
    pdf = parseStatementLines(lines, { accountKind: kind });
    if (!pdf.rows.length) throw new AppError("No transactions were found in this PDF. Try the CSV or XLSX export from your bank.", 422, "NO_ROWS");
    institutionText = lines.slice(0, 60).join(" ");
  } else {
    try {
      rawRows = fileKind === "CSV" ? parseCsv(buffer) : await parseXlsx(buffer);
    } catch {
      throw new AppError("This file couldn't be read. Check that it is a valid CSV/XLSX export.", 422, "FILE_UNREADABLE");
    }
    if (rawRows.length < 2) throw new AppError("No rows were found in this file.", 422, "NO_ROWS");
    institutionText = rawRows.slice(0, 15).map((r) => r.join(" ")).join(" ");
  }
  const rowCount = pdf ? pdf.rows.length : rawRows.length;
  if (rowCount > MAX_IMPORT_ROWS) throw new AppError(`Statements up to ${MAX_IMPORT_ROWS} rows are supported — split the file by date range.`, 413, "TOO_MANY_ROWS");

  const storageKey = await saveFile(userId, buffer, fileKind === "XLSX" ? "xlsx" : fileKind.toLowerCase());
  const institution = detectInstitution(institutionText);
  const sourceType = SOURCE_OF[fileKind];

  // Suggested mapping (or a saved template whose header signature matches).
  let suggestion: { headerRowIndex: number; mapping: StoredMapping; dateFormat: DateFormat | null; amountMode: AmountMode; templateId: string | null } | null = null;
  if (!pdf) {
    const headerRowIndex = findHeaderRow(rawRows);
    const headers = rawRows[headerRowIndex] ?? [];
    const signature = headerSignature(headers);
    const templates = await prisma.importMappingTemplate.findMany({ where: { userId, fileType: { in: ["CSV", "XLSX"] } } });
    const tpl = templates.find((t) => (t.columnMapping as { signature?: string } | null)?.signature === signature);
    if (tpl) {
      const m = tpl.columnMapping as { signature: string; byHeader: Partial<Record<MappingField, string>>; positiveIs?: "CREDIT" | "DEBIT" };
      const fields: ColumnMapping = {};
      for (const [f, h] of Object.entries(m.byHeader) as [MappingField, string][]) {
        const idx = headers.findIndex((x) => x.trim() === h);
        if (idx >= 0) fields[f] = idx;
      }
      suggestion = { headerRowIndex, mapping: { fields, positiveIs: m.positiveIs ?? "CREDIT", headers }, dateFormat: tpl.dateFormat as DateFormat, amountMode: tpl.amountMode, templateId: tpl.id };
    } else {
      const fields = suggestMapping(headers);
      const dateCol = fields.transactionDate;
      const dateFormat = dateCol === undefined ? null : detectDateFormat(rawRows.slice(headerRowIndex + 1).map((r) => r[dateCol] ?? ""));
      suggestion = { headerRowIndex, mapping: { fields, positiveIs: kind === "card" ? "DEBIT" : "CREDIT", headers }, dateFormat, amountMode: suggestAmountMode(fields), templateId: null };
    }
  }

  const imp = await prisma.$transaction(async (tx) => {
    const attachment = await tx.attachment.create({
      data: { userId, kind: "STATEMENT", fileName: safeName, mimeType: input.file.type || "application/octet-stream", sizeBytes: buffer.length, sha256: hash, storageKey },
    });
    const created = await tx.transactionImport.create({
      data: {
        userId,
        sourceType,
        status: pdf ? "PARSING" : "AWAITING_MAPPING",
        fileName: safeName,
        mimeType: attachment.mimeType,
        fileSizeBytes: buffer.length,
        fileSha256: hash,
        detectedInstitution: institution,
        bankAccountId: kind === "bank" ? id : null,
        creditCardId: kind === "card" ? id : null,
        attachmentId: attachment.id,
        totalRows: rowCount,
        headerRowIndex: suggestion?.headerRowIndex ?? null,
        columnMapping: suggestion ? (suggestion.mapping as unknown as Prisma.InputJsonObject) : undefined,
        dateFormat: suggestion?.dateFormat ?? null,
        amountMode: suggestion?.amountMode ?? null,
        mappingTemplateId: suggestion?.templateId ?? null,
        parseConfidence: pdf ? Math.round(pdf.verifiedShare * 10000) / 100 : null,
      },
    });
    if (pdf) {
      await tx.transactionImportRow.createMany({
        data: pdf.rows.map((r, i) => ({
          importId: created.id,
          rowNumber: i + 1,
          rawData: { line: r.raw, method: r.method },
          transactionDate: r.transactionDate,
          amount: toDecimal(r.amount),
          direction: r.direction ?? "DEBIT",
          description: r.description.slice(0, 300),
          referenceNumber: r.referenceNumber,
          balance: r.balance ? toDecimal(r.balance) : null,
          confidenceScore: r.direction ? r.confidence : Math.min(r.confidence, 50),
          status: "VALID" as ImportRowStatus,
        })),
      });
      await tx.statement.create({
        data: { userId, type: kind === "bank" ? "BANK" : "CREDIT_CARD", bankAccountId: kind === "bank" ? id : null, creditCardId: kind === "card" ? id : null, importId: created.id, attachmentId: attachment.id, openingBalance: pdf.openingBalance ? toDecimal(pdf.openingBalance) : null, status: "PROCESSING" },
      });
    } else {
      for (let i = 0; i < rawRows.length; i += 1000) {
        await tx.transactionImportRow.createMany({
          data: rawRows.slice(i, i + 1000).map((cells, j) => ({ importId: created.id, rowNumber: i + j, rawData: cells, status: "PENDING" as ImportRowStatus })),
        });
      }
    }
    await audit({ userId, action: AuditAction.IMPORT_UPLOADED, entityType: "TransactionImport", entityId: created.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { fileType: fileKind, rows: rowCount, account: accountStr, passwordProtected: Boolean(input.password) } }, tx);
    return created;
  });

  if (pdf) await analyzeImport(userId, imp.id);
  return { id: imp.id, fileKind, previousImportAt: previous?.completedAt ?? null };
}

// ───────────────────────────── mapping (CSV / XLSX) ─────────────────────────────

type ParsedCells = { ok: true; date: Date; amount: string; direction: "DEBIT" | "CREDIT"; description: string; reference: string | null; balance: string | null } | { ok: false; skip: boolean; error: string };

const NOT_A_TXN = /^(total|grand total|opening balance|closing balance|balance b\/?f|carried forward|brought forward|statement summary|\*+|-+|end of statement)/i;

/** Pure: apply a column mapping to one raw row. */
export function parseMappedRow(cells: string[], m: ColumnMappingData): ParsedCells {
  const cell = (i: number | null | undefined) => (i === null || i === undefined ? "" : (cells[i] ?? "").trim());
  const rawDate = cell(m.transactionDate);
  const description = cell(m.description).replace(/\s+/g, " ");
  const date = parseDateWith(rawDate, m.dateFormat) ?? parseDateWith(rawDate, "yyyy-MM-dd");

  let amount: string | null = null;
  let direction: "DEBIT" | "CREDIT" | null = null;
  let amountProblem: string | null = null;
  if (m.amountMode === "DEBIT_CREDIT_COLUMNS") {
    const d = parseAmount(cell(m.debit));
    const c = parseAmount(cell(m.credit));
    const dz = !d || isZeroAmount(d.amount);
    const cz = !c || isZeroAmount(c.amount);
    if (!dz && !cz) amountProblem = "Both debit and credit have a value";
    else if (!dz) [amount, direction] = [d!.amount.replace("-", ""), "DEBIT"];
    else if (!cz) [amount, direction] = [c!.amount.replace("-", ""), "CREDIT"];
    else if ((cell(m.debit) && !d) || (cell(m.credit) && !c)) amountProblem = "Amount isn't a number";
  } else {
    const raw = cell(m.amount);
    const a = parseAmount(raw);
    if (raw && !a) amountProblem = "Amount isn't a number";
    else if (a && !isZeroAmount(a.amount)) {
      amount = a.amount.replace("-", "");
      if (m.amountMode === "AMOUNT_WITH_TYPE_COLUMN") {
        const t = cell(m.type).toUpperCase();
        direction = /^(CR|CREDIT|C|DEPOSIT)\b/.test(t) ? "CREDIT" : /^(DR|DEBIT|D|WITHDRAWAL)\b/.test(t) ? "DEBIT" : a.suffix ? (a.suffix === "CR" ? "CREDIT" : "DEBIT") : null;
        if (!direction) amountProblem = `Unknown Dr/Cr value "${cell(m.type).slice(0, 12)}"`;
      } else if (a.suffix) {
        direction = a.suffix === "CR" ? "CREDIT" : "DEBIT";
      } else {
        const negative = a.amount.startsWith("-");
        const positiveIs = m.positiveIs;
        direction = negative ? (positiveIs === "CREDIT" ? "DEBIT" : "CREDIT") : positiveIs;
      }
    }
  }

  if (!date) {
    if (!amount || NOT_A_TXN.test(description) || NOT_A_TXN.test(rawDate)) return { ok: false, skip: true, error: "Not a transaction row" };
    return { ok: false, skip: false, error: rawDate ? `Date "${rawDate.slice(0, 20)}" doesn't match ${m.dateFormat}` : "Missing date" };
  }
  if (amountProblem) return { ok: false, skip: false, error: amountProblem };
  if (!amount || !direction) {
    if (NOT_A_TXN.test(description)) return { ok: false, skip: true, error: "Not a transaction row" };
    return { ok: false, skip: true, error: "No amount (informational row)" };
  }
  let reference = cell(m.referenceNumber).replace(/\s+/g, "") || null;
  if (reference && /^0+$/.test(reference)) reference = null;
  const bal = parseAmount(cell(m.balance));
  return {
    ok: true,
    date,
    amount,
    direction,
    description: description || "Statement entry",
    reference: (reference ?? extractReference(description))?.slice(0, 64) ?? null,
    balance: bal ? (bal.suffix === "DR" ? `-${bal.amount.replace("-", "")}` : bal.amount) : null,
  };
}

/** Preview of the first rows with a mapping — powers the live mapping screen. */
export async function previewMapping(userId: string, importId: string, input: unknown) {
  const m = parseOrThrow(columnMappingSchema, input);
  const imp = await findOwnedImport(prisma, userId, importId);
  const rows = await prisma.transactionImportRow.findMany({ where: { importId: imp.id, rowNumber: { gt: m.headerRowIndex } }, orderBy: { rowNumber: "asc" }, take: 12 });
  return rows.map((r) => {
    const p = parseMappedRow(r.rawData as string[], m);
    return p.ok
      ? { rowNumber: r.rowNumber, ok: true as const, date: p.date.toISOString().slice(0, 10), amount: p.amount, direction: p.direction, description: p.description }
      : { rowNumber: r.rowNumber, ok: false as const, skip: p.skip, error: p.error };
  });
}

export async function applyMapping(userId: string, importId: string, input: unknown, meta: RequestMeta = NO_META) {
  const m = parseOrThrow(columnMappingSchema, input);
  await prisma.$transaction(async (tx) => {
    await lockImport(tx, importId);
    const imp = await findOwnedImport(tx, userId, importId);
    assertStatus(imp, ["AWAITING_MAPPING", "AWAITING_REVIEW"], "This import has already been processed.");
    if (imp.sourceType === "PDF") throw new AppError("PDF statements don't use a column mapping.", 400, "NOT_TABULAR");
    const rows = await tx.transactionImportRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });
    const headers = (rows.find((r) => r.rowNumber === m.headerRowIndex)?.rawData as string[] | undefined) ?? [];
    let valid = 0;
    for (const r of rows) {
      const base = { transactionId: null, matchedTransactionId: null, matchedFields: [], duplicateScore: null, externalId: null, suggestedCategoryId: null, suggestedSubCategoryId: null, transactionType: null, merchantName: null };
      if (r.rowNumber <= m.headerRowIndex) {
        await tx.transactionImportRow.update({ where: { id: r.id }, data: { ...base, status: "SKIPPED", include: false, errorMessage: r.rowNumber === m.headerRowIndex ? "Header row" : "Above the header" } });
        continue;
      }
      const p = parseMappedRow(r.rawData as string[], m);
      if (p.ok) {
        valid++;
        await tx.transactionImportRow.update({
          where: { id: r.id },
          data: { ...base, status: "VALID", include: true, errorMessage: null, transactionDate: p.date, amount: toDecimal(p.amount), direction: p.direction, description: p.description.slice(0, 300), referenceNumber: p.reference, balance: p.balance ? toDecimal(p.balance) : null, confidenceScore: 95 },
        });
      } else {
        await tx.transactionImportRow.update({
          where: { id: r.id },
          data: { ...base, status: p.skip ? "SKIPPED" : "INVALID", include: false, errorMessage: p.error, transactionDate: null, amount: null, direction: null, description: null },
        });
      }
    }
    if (!valid) throw new AppError("No transactions could be read with this mapping. Check the header row, date format and amount columns.", 422, "NO_VALID_ROWS");

    let templateId = imp.mappingTemplateId;
    if (m.saveTemplateName) {
      const byHeader: Partial<Record<MappingField, string>> = {};
      for (const f of ["transactionDate", "description", "debit", "credit", "amount", "type", "referenceNumber", "balance"] as MappingField[]) {
        const idx = m[f];
        if (typeof idx === "number" && headers[idx]) byHeader[f] = headers[idx].trim();
      }
      const data = {
        institution: imp.detectedInstitution,
        fileType: imp.sourceType,
        columnMapping: { signature: headerSignature(headers), byHeader, positiveIs: m.positiveIs },
        amountMode: m.amountMode,
        dateFormat: m.dateFormat,
        headerRow: m.headerRowIndex,
      };
      const tpl = await tx.importMappingTemplate.upsert({ where: { userId_name: { userId, name: m.saveTemplateName } }, update: data, create: { userId, name: m.saveTemplateName, ...data } });
      templateId = tpl.id;
    }
    const fields: ColumnMapping = {};
    for (const f of ["transactionDate", "description", "debit", "credit", "amount", "type", "referenceNumber", "balance"] as MappingField[]) {
      const idx = m[f];
      if (typeof idx === "number") fields[f] = idx;
    }
    await tx.transactionImport.update({
      where: { id: importId },
      data: { status: "PARSING", headerRowIndex: m.headerRowIndex, dateFormat: m.dateFormat, amountMode: m.amountMode, columnMapping: { fields, positiveIs: m.positiveIs, headers } as unknown as Prisma.InputJsonObject, mappingTemplateId: templateId },
    });
    await audit({ userId, action: "import.mapped", entityType: "TransactionImport", entityId: importId, ip: meta.ip, userAgent: meta.userAgent, metadata: { validRows: valid, savedTemplate: Boolean(m.saveTemplateName) } }, tx);
  }, LONG_TX);
  await analyzeImport(userId, importId);
}

// ───────────────────────────── analysis ─────────────────────────────

/**
 * Classifies every VALID row, suggests a category, and checks it against the
 * ledger: rows already imported from a statement are skipped, high-confidence
 * duplicates will be linked to the existing transaction, possible duplicates go
 * to review. Read-only for the ledger.
 */
export async function analyzeImport(userId: string, importId: string) {
  const imp = await findOwnedImport(prisma, userId, importId);
  const account = accountOfImport(imp);
  const rules = await loadRulesForMatching(prisma, userId);
  const rows = await prisma.transactionImportRow.findMany({
    where: { importId, status: { in: ["VALID", "DUPLICATE", "POSSIBLE_DUPLICATE"] } },
    orderBy: { rowNumber: "asc" },
  });
  const occurrences = new Map<string, number>();
  const claimed = new Set<string>();
  for (const r of rows) {
    if (!r.transactionDate || !r.amount || !r.direction || !r.description) continue;
    const amount = r.amount.toFixed(2);
    const occKey = `${r.transactionDate.toISOString()}|${amount}|${r.direction}|${r.description}`;
    const occurrence = (occurrences.get(occKey) ?? 0) + 1;
    occurrences.set(occKey, occurrence);
    const externalId = statementFingerprint(account, r.transactionDate, amount, r.direction, r.description, occurrence);

    const type = (r.transactionType ?? classifyImported(r.direction, account.kind, r.description)) as TransactionType;
    let confidence = Number(r.confidenceScore ?? 95);
    let creditCardId: string | null = null;
    if (type === "CARD_PAYMENT" && account.kind === "bank") {
      const card = await resolvePaidCard(prisma, userId, r.description);
      creditCardId = card?.id ?? null;
      if (!card?.exact) confidence = Math.min(confidence, 70);
    }
    const merchantName = merchantFor(type, r.description);
    const row: IngestRow = { account, transactionDate: r.transactionDate, amount, direction: r.direction, transactionType: type, description: r.description, merchantName, referenceNumber: r.referenceNumber, creditCardId, categoryId: null, subCategoryId: null, confidence };
    const cat = r.suggestedCategoryId && r.transactionType
      ? { categoryId: r.suggestedCategoryId, subCategoryId: r.suggestedSubCategoryId }
      : await suggestCategory(prisma, userId, rules, row);

    const already = await prisma.transactionSource.findFirst({
      where: { userId, sourceType: { in: STATEMENT_SOURCES }, externalId, transaction: { deletedAt: null } },
      select: { transactionId: true },
    });
    let data: Prisma.TransactionImportRowUpdateInput;
    if (already) {
      data = { status: "SKIPPED", include: false, errorMessage: "Already imported from an earlier statement", matchedTransactionId: already.transactionId, duplicateScore: 100, matchedFields: ["statement row"] };
    } else {
      const hit = await findDuplicate(prisma, userId, row, claimed);
      if (hit?.verdict === "AUTO_MATCH") claimed.add(hit.transactionId);
      data = {
        status: hit?.verdict === "AUTO_MATCH" ? "DUPLICATE" : hit?.verdict === "REVIEW" ? "POSSIBLE_DUPLICATE" : "VALID",
        matchedTransactionId: hit?.transactionId ?? null,
        duplicateScore: hit?.score ?? null,
        matchedFields: hit?.matchedFields ?? [],
        errorMessage: null,
      };
    }
    await prisma.transactionImportRow.update({
      where: { id: r.id },
      data: { ...data, externalId, transactionType: type, merchantName, confidenceScore: confidence, suggestedCategoryId: cat.categoryId, suggestedSubCategoryId: cat.subCategoryId },
    });
  }
  await prisma.transactionImport.update({ where: { id: importId }, data: { status: "AWAITING_REVIEW" } });
}

// ───────────────────────────── review edits ─────────────────────────────

export async function updateImportRow(userId: string, importId: string, rowId: string, input: unknown) {
  assertIds(importId, rowId);
  const d = parseOrThrow(importRowUpdateSchema, input);
  const has = (k: string) => typeof input === "object" && input !== null && k in input;
  const imp = await findOwnedImport(prisma, userId, importId);
  assertStatus(imp, ["AWAITING_REVIEW"], "This import can no longer be changed.");
  const row = await prisma.transactionImportRow.findFirst({ where: { id: rowId, importId: imp.id } });
  if (!row) throw new NotFoundError("Row not found.");
  if (["INVALID", "SKIPPED"].includes(row.status) && d.include) throw new AppError("This row can't be imported.", 400, "ROW_NOT_IMPORTABLE");
  const data: Prisma.TransactionImportRowUpdateInput = {};
  if (d.include !== undefined) data.include = d.include;
  if (d.transactionType && d.transactionType !== row.transactionType) {
    const direction = row.direction ?? "DEBIT";
    const allowed = ["INCOME", "INTEREST", "REFUND", "REVERSAL"].includes(d.transactionType) ? "CREDIT" : d.transactionType === "OTHER" || d.transactionType === "CARD_PAYMENT" ? direction : "DEBIT";
    if (allowed !== direction) throw new AppError(`A ${direction === "DEBIT" ? "money-out" : "money-in"} row can't be marked as ${d.transactionType.toLowerCase().replace("_", " ")}.`, 400, "INVALID_TYPE", { transactionType: ["Not valid for this row's direction"] });
    data.transactionType = d.transactionType;
    data.merchantName = merchantFor(d.transactionType, row.description ?? "");
    if (!has("categoryId")) {
      const cat = await suggestCategory(prisma, userId, await loadRulesForMatching(prisma, userId), {
        transactionType: d.transactionType,
        direction,
        description: row.description ?? "",
        merchantName: data.merchantName as string | null,
        amount: row.amount?.toFixed(2) ?? "0",
        account: accountOfImport(imp),
      });
      data.suggestedCategoryId = cat.categoryId;
      data.suggestedSubCategoryId = cat.subCategoryId;
    }
  }
  if (has("categoryId")) {
    if (d.categoryId) await assertCategory(prisma, userId, d.categoryId, d.subCategoryId);
    data.suggestedCategoryId = d.categoryId;
    data.suggestedSubCategoryId = d.categoryId ? d.subCategoryId : null;
  }
  await prisma.transactionImportRow.update({ where: { id: row.id }, data });
}

export async function setAllIncluded(userId: string, importId: string, include: boolean) {
  const imp = await findOwnedImport(prisma, userId, importId);
  assertStatus(imp, ["AWAITING_REVIEW"], "This import can no longer be changed.");
  await prisma.transactionImportRow.updateMany({ where: { importId: imp.id, status: { in: ["VALID", "DUPLICATE", "POSSIBLE_DUPLICATE"] } }, data: { include } });
}

export async function cancelImport(userId: string, importId: string, meta: RequestMeta = NO_META) {
  await prisma.$transaction(async (tx) => {
    await lockImport(tx, importId);
    const imp = await findOwnedImport(tx, userId, importId);
    assertStatus(imp, ["UPLOADED", "PARSING", "AWAITING_MAPPING", "AWAITING_REVIEW", "FAILED"], "A completed import can't be cancelled — use Undo instead.");
    await tx.transactionImport.update({ where: { id: importId }, data: { status: "CANCELLED", completedAt: new Date() } });
    await tx.statement.updateMany({ where: { importId }, data: { deletedAt: new Date() } });
    await audit({ userId, action: "import.cancelled", entityType: "TransactionImport", entityId: importId, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

// ───────────────────────────── commit ─────────────────────────────

export type ImportSummary = { created: number; linked: number; possibleDuplicates: number; pendingReview: number; skipped: number; invalid: number };

/**
 * Writes the reviewed rows to the ledger in ONE database transaction:
 *   DUPLICATE          → source attached to the existing transaction (counted once)
 *   POSSIBLE_DUPLICATE → new transaction, pending review, with a duplicate candidate
 *   VALID              → new transaction (pending review when confidence < 80)
 * Then balances are recomputed from the ledger.
 */
export async function commitImport(userId: string, importId: string, meta: RequestMeta = NO_META): Promise<ImportSummary> {
  return prisma.$transaction(async (tx) => {
    await lockImport(tx, importId);
    const imp = await findOwnedImport(tx, userId, importId);
    assertStatus(imp, ["AWAITING_REVIEW"], imp.status === "COMPLETED" ? "This import was already completed." : "This import isn't ready to import.");
    const account = accountOfImport(imp);
    const affected = emptyAffected();
    collectAffected(affected, { bankAccountId: imp.bankAccountId, creditCardId: imp.creditCardId });
    const rows = await tx.transactionImportRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });
    for (const r of rows) if (r.include && r.transactionType === "CARD_PAYMENT" && account.kind === "bank") {
      const card = await resolvePaidCard(tx, userId, r.description ?? "");
      if (card) affected.card.add(card.id);
    }
    for (const r of rows) if (r.matchedTransactionId) {
      const m = await tx.transaction.findUnique({ where: { id: r.matchedTransactionId }, select: { bankAccountId: true, creditCardId: true, cashAccountId: true } });
      collectAffected(affected, m);
    }
    await lockForWrite(tx, affected);

    const summary: ImportSummary = { created: 0, linked: 0, possibleDuplicates: 0, pendingReview: 0, skipped: 0, invalid: 0 };
    const statement =
      (await tx.statement.findFirst({ where: { importId, deletedAt: null } })) ??
      (await tx.statement.create({ data: { userId, type: account.kind === "bank" ? "BANK" : "CREDIT_CARD", bankAccountId: imp.bankAccountId, creditCardId: imp.creditCardId, importId, attachmentId: imp.attachmentId, status: "PROCESSING" } }));
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    let lastBalance: Prisma.Decimal | null = null;
    let statementRowNo = 0;

    for (const r of rows) {
      if (r.status === "INVALID") {
        summary.invalid++;
        continue;
      }
      if (r.status === "SKIPPED") {
        if (r.errorMessage?.startsWith("Already imported")) summary.skipped++;
        continue;
      }
      if (!r.include || !r.transactionDate || !r.amount || !r.direction || !r.description) {
        await tx.transactionImportRow.update({ where: { id: r.id }, data: { status: "SKIPPED", errorMessage: "Excluded during review" } });
        summary.skipped++;
        continue;
      }
      const type = (r.transactionType ?? "EXPENSE") as TransactionType;
      const confidence = Number(r.confidenceScore ?? 95);
      const card = type === "CARD_PAYMENT" && account.kind === "bank" ? await resolvePaidCard(tx, userId, r.description) : null;
      const row: IngestRow = {
        account,
        transactionDate: r.transactionDate,
        amount: r.amount.toFixed(2),
        direction: r.direction,
        transactionType: type,
        description: r.description,
        merchantName: r.merchantName,
        referenceNumber: r.referenceNumber,
        creditCardId: card?.id ?? null,
        categoryId: r.suggestedCategoryId,
        subCategoryId: r.suggestedSubCategoryId,
        confidence,
      };
      if (row.categoryId) {
        // Category may have been deleted since analysis.
        const ok = await tx.category.findFirst({ where: { id: row.categoryId, deletedAt: null, OR: [{ userId: null }, { userId }] }, select: { id: true } });
        if (!ok) [row.categoryId, row.subCategoryId] = [null, null];
      }
      const source = { sourceType: imp.sourceType, externalId: r.externalId, importId, importRowId: r.id, rawDescription: r.description, confidence, metadata: { rowNumber: r.rowNumber } };

      // Duplicate-by-fingerprint race (same statement committed twice in parallel).
      if (r.externalId) {
        const dupe = await tx.transactionSource.findFirst({ where: { userId, sourceType: { in: STATEMENT_SOURCES }, externalId: r.externalId, transaction: { deletedAt: null } } });
        if (dupe) {
          await tx.transactionImportRow.update({ where: { id: r.id }, data: { status: "SKIPPED", errorMessage: "Already imported from an earlier statement" } });
          summary.skipped++;
          continue;
        }
      }

      let transactionId: string;
      let rowStatus: ImportRowStatus = "IMPORTED";
      const matched = r.matchedTransactionId
        ? await tx.transaction.findFirst({ where: { id: r.matchedTransactionId, userId, deletedAt: null, duplicateOfId: null, status: { not: "REJECTED" } }, select: { id: true } })
        : null;
      if (r.status === "DUPLICATE" && matched) {
        const a = await attachToExisting(tx, userId, matched.id, row, source);
        mergeAffected(affected, a);
        transactionId = matched.id;
        rowStatus = "DUPLICATE";
        summary.linked++;
      } else {
        const possible = r.status === "POSSIBLE_DUPLICATE" && matched;
        const pending = possible || confidence < REVIEW_CONFIDENCE;
        const t = await createIngestedTransaction(tx, userId, row, { status: pending ? "PENDING_REVIEW" : "CONFIRMED", duplicateStatus: possible ? "POSSIBLE_DUPLICATE" : "UNIQUE" }, source);
        collectAffected(affected, t);
        if (possible) {
          await tx.transactionDuplicateCandidate.create({
            data: { userId, transactionId: t.id, matchedTransactionId: matched.id, score: r.duplicateScore ?? 0, matchedFields: r.matchedFields },
          });
          summary.possibleDuplicates++;
          rowStatus = "POSSIBLE_DUPLICATE";
        } else if (pending) summary.pendingReview++;
        transactionId = t.id;
        summary.created++;
      }
      await tx.transactionImportRow.update({ where: { id: r.id }, data: { status: rowStatus, transactionId } });
      await tx.statementRow.create({
        data: {
          statementId: statement.id,
          rowNumber: ++statementRowNo,
          transactionDate: r.transactionDate,
          description: r.description,
          debit: r.direction === "DEBIT" ? r.amount : null,
          credit: r.direction === "CREDIT" ? r.amount : null,
          balance: r.balance,
          referenceNumber: r.referenceNumber,
          transactionId,
        },
      });
      if (!minDate || r.transactionDate < minDate) minDate = r.transactionDate;
      if (!maxDate || r.transactionDate > maxDate) maxDate = r.transactionDate;
      if (r.balance) lastBalance = r.balance;
    }

    await recomputeAffected(tx, affected);
    await tx.statement.update({ where: { id: statement.id }, data: { periodStart: minDate, periodEnd: maxDate, statementDate: maxDate, closingBalance: lastBalance, status: "PROCESSED" } });
    await tx.transactionImport.update({
      where: { id: importId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        importedCount: summary.created,
        newCount: summary.created - summary.possibleDuplicates,
        duplicateCount: summary.linked,
        possibleDuplicateCount: summary.possibleDuplicates,
        failedCount: summary.invalid,
      },
    });
    await audit({ userId, action: AuditAction.IMPORT_COMPLETED, entityType: "TransactionImport", entityId: importId, ip: meta.ip, userAgent: meta.userAgent, metadata: summary }, tx);
    return summary;
  }, LONG_TX);
}

function mergeAffected(into: AffectedAccounts, from: AffectedAccounts) {
  from.bank.forEach((x) => into.bank.add(x));
  from.card.forEach((x) => into.card.add(x));
  from.cash.forEach((x) => into.cash.add(x));
}

// ───────────────────────────── undo ─────────────────────────────

/**
 * Reverses a completed import: transactions it created are removed (unless
 * another source — e.g. an email — has since confirmed them, in which case only
 * this statement's source is detached), sources it attached to existing
 * transactions are removed, and balances are recomputed.
 */
export async function undoImport(userId: string, importId: string, meta: RequestMeta = NO_META) {
  return prisma.$transaction(async (tx) => {
    await lockImport(tx, importId);
    const imp = await findOwnedImport(tx, userId, importId);
    assertStatus(imp, ["COMPLETED"], "Only a completed import can be undone.");
    const sources = await tx.transactionSource.findMany({ where: { userId, importId }, include: { transaction: true } });
    const affected = emptyAffected();
    sources.forEach((s) => collectAffected(affected, s.transaction));
    await lockForWrite(tx, affected);
    let removed = 0;
    let detached = 0;
    const retire = async (id: string) => {
      mergeAffected(affected, await promoteDuplicatesOf(tx, id));
      await tx.transaction.update({ where: { id }, data: { deletedAt: new Date() } });
      await tx.transactionDuplicateCandidate.deleteMany({ where: { OR: [{ transactionId: id }, { matchedTransactionId: id }] } });
      removed++;
    };
    for (const s of sources) {
      const t = s.transaction;
      const fill = (s.metadata ?? {}) as SourceFillMeta;
      // This row was confirmed as a duplicate of another transaction and filled it in → undo that.
      if (fill.filledOn) mergeAffected(affected, await revertFill(tx, fill.filledOn, fill.filled, fill.previous));
      if (t.deletedAt) {
        await tx.transactionSource.delete({ where: { id: s.id } });
        continue;
      }
      const others = await tx.transactionSource.count({ where: { transactionId: t.id, id: { not: s.id } } });
      if (t.importId === importId && others === 0) {
        await tx.transactionSource.delete({ where: { id: s.id } });
        await retire(t.id);
        continue;
      }
      mergeAffected(affected, await detachSource(tx, s.id));
      detached++;
      if (t.importId === importId) await tx.transaction.update({ where: { id: t.id }, data: { importId: null } });
      // Nothing confirms this transaction any more (every source was an import that is now undone).
      if (others === 0) {
        detached--;
        await retire(t.id);
      }
    }
    // Rows created by this import whose sources were merged elsewhere (hidden duplicates).
    const leftovers = await tx.transaction.findMany({ where: { importId, deletedAt: null, sources: { none: {} } } });
    for (const t of leftovers) {
      collectAffected(affected, t);
      await retire(t.id);
    }
    await lockForWrite(tx, affected);
    await recomputeAffected(tx, affected);
    await tx.statement.updateMany({ where: { importId }, data: { deletedAt: new Date() } });
    await tx.transactionImport.update({ where: { id: importId }, data: { status: "CANCELLED" } });
    await audit({ userId, action: AuditAction.IMPORT_UNDONE, entityType: "TransactionImport", entityId: importId, ip: meta.ip, userAgent: meta.userAgent, metadata: { removed, detached } }, tx);
    return { removed, detached };
  }, LONG_TX);
}

// ───────────────────────────── queries ─────────────────────────────

export async function listImports(userId: string) {
  return prisma.transactionImport.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      bankAccount: { select: { nickname: true, bankName: true, last4: true } },
      creditCard: { select: { cardName: true, bankName: true, last4: true } },
    },
  });
}

export type ImportListItem = Awaited<ReturnType<typeof listImports>>[number];

export async function getImport(userId: string, importId: string) {
  const imp = await prisma.transactionImport.findFirst({
    where: { id: importId, userId },
    include: {
      bankAccount: { select: { nickname: true, bankName: true, last4: true } },
      creditCard: { select: { cardName: true, bankName: true, last4: true } },
      mappingTemplate: { select: { name: true } },
    },
  });
  if (!imp) throw new NotFoundError("Import not found.");
  const rows = await prisma.transactionImportRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" }, take: MAX_IMPORT_ROWS });
  const matchedIds = [...new Set(rows.map((r) => r.matchedTransactionId).filter((x): x is string => Boolean(x)))];
  const matched = matchedIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: matchedIds }, userId },
        select: { id: true, transactionDate: true, amount: true, description: true, sourceType: true, merchantName: true },
      })
    : [];
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  return { imp, rows, matched: new Map(matched.map((m) => [m.id, m])), counts };
}

export type ImportDetail = Awaited<ReturnType<typeof getImport>>;
