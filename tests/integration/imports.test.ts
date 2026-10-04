import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { applyMapping, cancelImport, commitImport, createImport, getImport, undoImport, updateImportRow } from "@/services/import.service";
import { listDuplicateCandidates, listReviewQueue, resolveDuplicate, resolveReview, scanForDuplicates } from "@/services/duplicate.service";
import { countableWhere } from "@/lib/transactions/countable";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

const fixture = (f: string) => readFileSync(path.join(__dirname, "..", "fixtures", f));

const BANK_CSV = [
  "HDFC BANK Ltd.",
  "Account No : XXXX4821",
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  '01/10/26,NEFT CR-ACME TECHNOLOGIES SALARY,N274262012345678,01/10/26,,"85,000.00","1,35,000.00"',
  '03/10/26,UPI/412345678901/SWIGGY/swiggy@icici,412345678901,03/10/26,645.00,,"1,34,355.00"',
  '05/10/26,ATM CASH WDL MG ROAD,000000,05/10/26,"2,000.00",,"1,32,355.00"',
  '10/10/26,HDFC CREDIT CARD PAYMENT XX1043,,10/10/26,"24,500.00",,"1,07,855.00"',
  ',Total,,,"27,145.00","85,000.00",',
].join("\n");

const csvFile = (text: string, name = "hdfc.csv") => ({ name, type: "text/csv", buffer: Buffer.from(text) });

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
    if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
  }
}

/** Accept whatever the auto-detected mapping was (what the UI pre-fills). */
async function acceptSuggestedMapping(userId: string, importId: string, extra: Record<string, unknown> = {}) {
  const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: importId } });
  const m = imp.columnMapping as { fields: Record<string, number>; positiveIs: string };
  await applyMapping(userId, importId, { headerRowIndex: imp.headerRowIndex, dateFormat: imp.dateFormat, amountMode: imp.amountMode, positiveIs: m.positiveIs, ...m.fields, ...extra }, meta);
}

describe("Phase 4 statement import & duplicates (integration)", () => {
  let userId: string;
  let bankId: string;
  let cardId: string;

  beforeEach(async () => {
    await resetDatabase();
    await seedCategories();
    userId = (await prisma.user.create({ data: { email: "import@example.com", name: "Import User" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", currentBalance: "50000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "HDFC Bank", cardName: "Regalia", last4: "1043", creditLimit: "300000", currentOutstanding: "30000" }, meta)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const bank = () => prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } });
  const card = () => prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });

  it("CSV: detects the header below bank metadata, maps columns, imports and recomputes balances", async () => {
    const up = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    expect(up.fileKind).toBe("CSV");
    const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: up.id } });
    expect(imp.status).toBe("AWAITING_MAPPING");
    expect(imp.headerRowIndex).toBe(2);
    expect(imp.dateFormat).toBe("dd/MM/yy");
    expect(imp.amountMode).toBe("DEBIT_CREDIT_COLUMNS");
    expect(imp.detectedInstitution).toBe("HDFC Bank");

    await acceptSuggestedMapping(userId, up.id, { saveTemplateName: "HDFC savings" });
    const detail = await getImport(userId, up.id);
    expect(detail.imp.status).toBe("AWAITING_REVIEW");
    const valid = detail.rows.filter((r) => r.status === "VALID");
    expect(valid).toHaveLength(4);
    const byDesc = (s: string) => valid.find((r) => r.description?.includes(s))!;
    expect(byDesc("ACME").transactionType).toBe("INCOME");
    expect(byDesc("ATM").transactionType).toBe("ATM_WITHDRAWAL");
    expect(byDesc("ATM").referenceNumber).toBeNull(); // "000000" cheque no. ignored
    expect(byDesc("CREDIT CARD").transactionType).toBe("CARD_PAYMENT");
    expect(detail.rows.find((r) => r.description === null && (r.rawData as string[])[1] === "Total")?.status).toBe("SKIPPED");

    const summary = await commitImport(userId, up.id, meta);
    expect(summary).toMatchObject({ created: 4, linked: 0, possibleDuplicates: 0, pendingReview: 0, invalid: 0 });
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");
    // The bill payment was matched to the card ending 1043 and reduces its outstanding.
    expect((await card()).currentOutstanding.toFixed(2)).toBe("5500.00");
    const pay = await prisma.transaction.findFirstOrThrow({ where: { userId, transactionType: "CARD_PAYMENT" } });
    expect(pay.creditCardId).toBe(cardId);
    const salary = await prisma.transaction.findFirstOrThrow({ where: { userId, transactionType: "INCOME" }, include: { income: true, sources: true } });
    expect(salary.income?.incomeCategory).toBe("SALARY");
    expect(salary.sources).toHaveLength(1);
    expect(salary.sources[0].sourceType).toBe("CSV");
    const st = await prisma.statement.findFirstOrThrow({ where: { importId: up.id }, include: { rows: true } });
    expect(st.rows).toHaveLength(4);
    expect(st.closingBalance?.toFixed(2)).toBe("107855.00");
    expect(st.periodStart?.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(await prisma.importMappingTemplate.count({ where: { userId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "import.completed" } })).toBe(1);
  });

  it("re-uploading the same statement imports nothing twice; the saved template pre-fills the mapping", async () => {
    const first = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    await acceptSuggestedMapping(userId, first.id, { saveTemplateName: "HDFC" });
    await commitImport(userId, first.id, meta);

    const again = await createImport(userId, { file: csvFile(BANK_CSV, "again.csv"), account: `bank:${bankId}` }, meta);
    expect(again.previousImportAt).not.toBeNull();
    const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: again.id } });
    expect(imp.mappingTemplateId).not.toBeNull();
    await acceptSuggestedMapping(userId, again.id);
    const d = await getImport(userId, again.id);
    expect(d.rows.filter((r) => r.errorMessage?.startsWith("Already imported"))).toHaveLength(4);
    const s = await commitImport(userId, again.id, meta);
    expect(s.created).toBe(0);
    expect(s.skipped).toBe(4);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(4);
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");
    await expect(commitImport(userId, again.id, meta)).rejects.toMatchObject({ code: "IMPORT_STATE" });
  });

  it("ACCEPTANCE §47: an email-sourced transaction + the same statement row = ONE transaction with two sources, counted once", async () => {
    // Simulates the Gmail alert (email sync arrives in a later phase; the ledger shape is the same).
    const gmail = await prisma.transaction.create({
      data: {
        userId, creditCardId: cardId, transactionDate: new Date("2026-10-05T00:00:00Z"), amount: "1250.00", direction: "DEBIT", transactionType: "EXPENSE",
        merchantName: "AMAZON", description: "Amazon purchase alert", normalizedDescription: "AMAZON PURCHASE ALERT", sourceType: "GMAIL", duplicateStatus: "UNIQUE", confidenceScore: 92,
        sources: { create: { userId, sourceType: "GMAIL", externalId: "gmail-msg-1", rawDescription: "Rs.1250 spent on HDFC card XX1043 at AMAZON" } },
      },
    });
    const { recomputeCardOutstanding } = await import("@/services/ledger-balance.service");
    await recomputeCardOutstanding(prisma, cardId);
    expect((await card()).currentOutstanding.toFixed(2)).toBe("31250.00");

    const csv = ["Transaction Date,Details,Amount", "05/10/2026,AMAZON PAY INDIA PVT LTD,1250.00", "06/10/2026,UBER INDIA,349.00"].join("\n");
    const up = await createImport(userId, { file: csvFile(csv, "card.csv"), account: `card:${cardId}` }, meta);
    await acceptSuggestedMapping(userId, up.id);
    const d = await getImport(userId, up.id);
    const amazon = d.rows.find((r) => r.description?.startsWith("AMAZON"))!;
    expect(amazon.status).toBe("DUPLICATE");
    expect(amazon.matchedTransactionId).toBe(gmail.id);
    expect(Number(amazon.duplicateScore)).toBeGreaterThanOrEqual(95);

    const s = await commitImport(userId, up.id, meta);
    expect(s).toMatchObject({ created: 1, linked: 1 });
    const merged = await prisma.transaction.findUniqueOrThrow({ where: { id: gmail.id }, include: { sources: true } });
    expect(merged.sources.map((x) => x.sourceType).sort()).toEqual(["CSV", "GMAIL"]);
    expect(await prisma.transaction.count({ where: countableWhere(userId, { amount: "1250.00" }) })).toBe(1);
    // Outstanding moved by 349 only — the ₹1,250 purchase is not double counted.
    expect((await card()).currentOutstanding.toFixed(2)).toBe("31599.00");
  });

  it("possible duplicate → pending review (not counted) → resolve with each action", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-10-02", amount: "645", account: `bank:${bankId}`, description: "Dinner order" }, meta);
    expect((await bank()).currentBalance.toFixed(2)).toBe("49355.00");
    const up = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    await acceptSuggestedMapping(userId, up.id);
    const row = (await getImport(userId, up.id)).rows.find((r) => r.description?.includes("SWIGGY"))!;
    expect(row.status).toBe("POSSIBLE_DUPLICATE");
    const s = await commitImport(userId, up.id, meta);
    expect(s.possibleDuplicates).toBe(1);
    // 50000 − 645 (manual) + 85000 − 2000 − 24500; the pending ₹645 isn't counted yet.
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");

    let pairs = await listDuplicateCandidates(userId);
    expect(pairs).toHaveLength(1);
    expect(await listReviewQueue(userId)).toHaveLength(0); // shown under duplicates, not in the plain review queue

    await resolveDuplicate(userId, pairs[0].id, { action: "KEEP_BOTH" }, meta);
    expect((await bank()).currentBalance.toFixed(2)).toBe("107210.00");
    await expect(resolveDuplicate(userId, pairs[0].id, { action: "MERGE" }, meta)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });

    // Flag it again via the scanner, then merge: sources move to the original and it is counted once.
    await prisma.transactionSource.updateMany({ where: { userId, sourceType: "MANUAL" }, data: { sourceType: "GMAIL" } });
    await prisma.transactionDuplicateCandidate.deleteMany({});
    const scan = await scanForDuplicates(userId, 3650, meta);
    expect(scan.flagged).toBe(1);
    pairs = await listDuplicateCandidates(userId);
    await resolveDuplicate(userId, pairs[0].id, { action: "MERGE" }, meta);
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");
    const original = await prisma.transaction.findUniqueOrThrow({ where: { id: pairs[0].matchedTransactionId }, include: { sources: true } });
    expect(original.sources).toHaveLength(2);
    const hidden = await prisma.transaction.findUniqueOrThrow({ where: { id: pairs[0].transactionId } });
    expect(hidden.duplicateStatus).toBe("MERGED");
    expect(hidden.duplicateOfId).toBe(original.id);
    expect(await prisma.auditLog.count({ where: { action: "duplicate.resolved" } })).toBe(2);
  });

  it("PDF: password handled in memory only, running balance decides debit/credit, low-confidence rows go to the review queue", async () => {
    await expect(createImport(userId, { file: { name: "s.pdf", type: "application/pdf", buffer: fixture("bank-statement-locked.pdf") }, account: `bank:${bankId}` }, meta)).rejects.toMatchObject({ code: "PDF_PASSWORD_REQUIRED" });
    await expect(createImport(userId, { file: { name: "s.pdf", type: "application/pdf", buffer: fixture("bank-statement-locked.pdf") }, account: `bank:${bankId}`, password: "nope" }, meta)).rejects.toMatchObject({ code: "PDF_PASSWORD_INCORRECT" });
    expect(await prisma.attachment.count()).toBe(0); // nothing stored for failed attempts

    const up = await createImport(userId, { file: { name: "s.pdf", type: "application/pdf", buffer: fixture("bank-statement-locked.pdf") }, account: `bank:${bankId}`, password: "FS1234" }, meta);
    const d = await getImport(userId, up.id);
    expect(d.imp.status).toBe("AWAITING_REVIEW");
    expect(Number(d.imp.parseConfidence)).toBe(100);
    expect(d.rows).toHaveLength(4);
    expect(d.rows.map((r) => [r.direction, r.amount?.toFixed(2)])).toEqual([["CREDIT", "85000.00"], ["DEBIT", "645.00"], ["DEBIT", "2000.00"], ["DEBIT", "24500.00"]]);
    expect(d.rows[0].description).toBe("NEFT CR-ACME TECHNOLOGIES SALARY OCT 2026");
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { action: "import.uploaded" } });
    expect(JSON.stringify(auditRow)).not.toContain("FS1234");
    expect(JSON.stringify(await prisma.transactionImport.findMany())).not.toContain("FS1234");

    // Mark one row as low-confidence to exercise the review queue.
    await prisma.transactionImportRow.update({ where: { id: d.rows[2].id }, data: { confidenceScore: 50 } });
    const s = await commitImport(userId, up.id, meta);
    expect(s).toMatchObject({ created: 4, pendingReview: 1 });
    expect((await bank()).currentBalance.toFixed(2)).toBe("109855.00"); // ATM ₹2,000 still pending
    const queue = await listReviewQueue(userId);
    expect(queue).toHaveLength(1);
    await resolveReview(userId, { action: "APPROVE", ids: [queue[0].id] }, meta);
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");
    expect(await listReviewQueue(userId)).toHaveLength(0);
  });

  it("undo removes what the import created, detaches what it linked, and restores balances", async () => {
    const gmail = await prisma.transaction.create({
      data: {
        userId, bankAccountId: bankId, transactionDate: new Date("2026-10-03T00:00:00Z"), amount: "645.00", direction: "DEBIT", transactionType: "EXPENSE",
        merchantName: "SWIGGY", description: "Swiggy order", normalizedDescription: "SWIGGY ORDER", sourceType: "GMAIL", referenceNumber: null,
        sources: { create: { userId, sourceType: "GMAIL", externalId: "gmail-2", rawDescription: "Swiggy" } },
      },
    });
    const { recomputeBankBalance } = await import("@/services/ledger-balance.service");
    await recomputeBankBalance(prisma, bankId);
    const up = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    await acceptSuggestedMapping(userId, up.id);
    const s = await commitImport(userId, up.id, meta);
    expect(s).toMatchObject({ created: 3, linked: 1 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: gmail.id } })).referenceNumber).toBe("412345678901"); // filled in

    const res = await undoImport(userId, up.id, meta);
    expect(res).toEqual({ removed: 3, detached: 1 });
    expect((await bank()).currentBalance.toFixed(2)).toBe("49355.00");
    expect((await card()).currentOutstanding.toFixed(2)).toBe("30000.00");
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: gmail.id }, include: { sources: true } });
    expect(after.sources).toHaveLength(1);
    expect(after.referenceNumber).toBeNull();
    // After undo the same file can be imported again.
    const again = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    await acceptSuggestedMapping(userId, again.id);
    expect((await commitImport(userId, again.id, meta)).created + 1).toBe(4);
  });

  it("XLSX card export with signed amounts; review edits (exclude, re-categorise, change type)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Txns");
    ws.addRow(["Card statement"]);
    ws.addRow(["Txn Date", "Description", "Amount (INR)"]);
    ws.addRow([new Date(Date.UTC(2026, 9, 7)), "ZOMATO ORDER", 450.5]);
    ws.addRow([new Date(Date.UTC(2026, 9, 8)), "AMAZON REFUND", -200]);
    ws.addRow([new Date(Date.UTC(2026, 9, 9)), "ANNUAL FEE", 499]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await createImport(userId, { file: { name: "card.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf }, account: `card:${cardId}` }, meta);
    expect(up.fileKind).toBe("XLSX");
    await acceptSuggestedMapping(userId, up.id, { dateFormat: "yyyy-MM-dd" });
    const d = await getImport(userId, up.id);
    const rows = d.rows.filter((r) => r.status === "VALID");
    expect(rows.map((r) => [r.direction, r.amount?.toFixed(2), r.transactionType])).toEqual([["DEBIT", "450.50", "EXPENSE"], ["CREDIT", "200.00", "REFUND"], ["DEBIT", "499.00", "FEE"]]);
    const food = await prisma.category.findFirstOrThrow({ where: { name: "Food", userId: null } });
    await updateImportRow(userId, up.id, rows[0].id, { categoryId: food.id, subCategoryId: null });
    await updateImportRow(userId, up.id, rows[2].id, { include: false });
    await expect(updateImportRow(userId, up.id, rows[1].id, { transactionType: "EXPENSE" })).rejects.toMatchObject({ code: "INVALID_TYPE" });
    const s = await commitImport(userId, up.id, meta);
    expect(s).toMatchObject({ created: 2, skipped: 1 });
    expect((await card()).currentOutstanding.toFixed(2)).toBe("30250.50");
    const z = await prisma.transaction.findFirstOrThrow({ where: { userId, description: "ZOMATO ORDER" }, include: { expense: true } });
    expect(z.categoryId).toBe(food.id);
    expect(z.expense?.paymentMethod).toBe("CREDIT_CARD");
  });

  it("rejects bad input and other users' imports", async () => {
    await expect(createImport(userId, { file: csvFile(BANK_CSV), account: "bank:nope" }, meta)).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
    await expect(createImport(userId, { file: { name: "x.xls", type: "", buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]) }, account: `bank:${bankId}` }, meta)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(createImport(userId, { file: { name: "x.pdf", type: "application/pdf", buffer: Buffer.from("%PDF-1.4 garbage") }, account: `bank:${bankId}` }, meta)).rejects.toMatchObject({ code: "PDF_UNREADABLE" });
    const up = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    await expect(getImport(other, up.id)).rejects.toMatchObject({ status: 404 });
    await expect(commitImport(other, up.id, meta)).rejects.toMatchObject({ status: 404 });
    await expect(commitImport(userId, up.id, meta)).rejects.toMatchObject({ code: "IMPORT_STATE" }); // still awaiting mapping
    await expect(applyMapping(userId, up.id, { headerRowIndex: 2, dateFormat: "yyyy-MM-dd", amountMode: "SIGNED_AMOUNT", transactionDate: 0, description: 1, amount: 4 }, meta)).rejects.toMatchObject({ code: "NO_VALID_ROWS" });
    await cancelImport(userId, up.id, meta);
    expect((await prisma.transactionImport.findUniqueOrThrow({ where: { id: up.id } })).status).toBe("CANCELLED");
    await expect(undoImport(userId, up.id, meta)).rejects.toMatchObject({ code: "IMPORT_STATE" });
  });

  it("two concurrent commits of the same file never double count", async () => {
    const a = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    const b = await createImport(userId, { file: csvFile(BANK_CSV), account: `bank:${bankId}` }, meta);
    await acceptSuggestedMapping(userId, a.id);
    await acceptSuggestedMapping(userId, b.id);
    const results = await Promise.allSettled([commitImport(userId, a.id, meta), commitImport(userId, b.id, meta)]);
    const created = results.filter((r) => r.status === "fulfilled").reduce((n, r) => n + (r as PromiseFulfilledResult<{ created: number }>).value.created, 0);
    expect(created).toBe(4);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(4);
    expect((await bank()).currentBalance.toFixed(2)).toBe("107855.00");
  });
});
