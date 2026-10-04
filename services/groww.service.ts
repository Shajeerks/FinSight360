import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { roundMoney, toDecimal } from "@/lib/money";
import { detectFileKind, MAX_UPLOAD_BYTES, parseCsv, parseXlsx } from "@/lib/import/files";
import { instrumentKeyOf } from "@/lib/investments/calc";
import { GrowwFileError, parseGrowwRows, type GrowwParseResult } from "@/lib/investments/groww";
import { recomputeHolding } from "@/services/investment.service";

/**
 * Groww import by FILE (holdings statement or order history exported from
 * Groww → Reports). FinSight360 never asks for a Groww password/OTP and never
 * calls unofficial endpoints. A second call with `commit: true` applies it.
 */

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

export type InvestmentImportPreview = {
  kind: GrowwParseResult["kind"];
  rows: number;
  skipped: GrowwParseResult["skipped"];
  holdings: { name: string; type: string; quantity: string; invested: string; current: string | null; action: "NEW" | "UPDATE" | "PRICE_ONLY" | "UNCHANGED" }[];
  removed: { name: string; quantity: string }[];
  transactions: { name: string; type: string; date: string; quantity: string; amount: string; duplicate: boolean }[];
  warnings: string[];
};

async function readRows(file: { name: string; buffer: Buffer }) {
  if (!file.buffer.length) throw new AppError("The file is empty.", 400, "EMPTY_FILE");
  if (file.buffer.length > MAX_UPLOAD_BYTES) throw new AppError("Files up to 10 MB are supported.", 413, "FILE_TOO_LARGE");
  const kind = detectFileKind(file.buffer, file.name);
  if (kind !== "CSV" && kind !== "XLSX") throw new AppError("Upload the XLSX or CSV report exactly as downloaded from Groww (Reports → Holdings / Transactions).", 415, "UNSUPPORTED_FILE");
  return kind === "CSV" ? parseCsv(file.buffer) : await parseXlsx(file.buffer);
}

export async function importInvestmentFile(
  userId: string,
  accountId: string,
  file: { name: string; buffer: Buffer },
  opts: { commit: boolean; removeMissing?: boolean },
  meta: RequestMeta = NO_META,
): Promise<InvestmentImportPreview & { committed: boolean }> {
  assertIds(accountId);
  const account = await prisma.investmentAccount.findFirst({ where: { id: accountId, userId, deletedAt: null } });
  if (!account) throw new NotFoundError("Investment account not found.");
  let parsed: GrowwParseResult;
  try {
    parsed = parseGrowwRows(await readRows(file));
  } catch (e) {
    if (e instanceof GrowwFileError) throw new AppError(e.message, 422, "UNRECOGNISED_FILE");
    throw e;
  }
  if (!parsed.holdings.length && !parsed.transactions.length) throw new AppError("No holdings or transactions were found in this file.", 422, "NO_ROWS");

  const run = async (tx: Tx) => {
    const preview: InvestmentImportPreview = { kind: parsed.kind, rows: parsed.holdings.length + parsed.transactions.length, skipped: parsed.skipped, holdings: [], removed: [], transactions: [], warnings: [] };
    const existing = await tx.investmentHolding.findMany({ where: { investmentAccountId: accountId }, include: { _count: { select: { transactions: { where: { deletedAt: null } } } } } });
    const byKey = new Map(existing.map((h) => [h.instrumentKey, h]));
    const touched = new Set<string>();

    if (parsed.kind === "HOLDINGS") {
      const seenKeys = new Set<string>();
      for (const p of parsed.holdings) {
        const key = instrumentKeyOf(p);
        seenKeys.add(key);
        const h = byKey.get(key);
        const qty = toDecimal(p.quantity);
        const invested = roundMoney(toDecimal(p.investedAmount));
        const price = p.currentPrice ? toDecimal(p.currentPrice) : null;
        const current = price ? roundMoney(qty.times(price)) : p.currentValue ? roundMoney(toDecimal(p.currentValue)) : null;
        let action: InvestmentImportPreview["holdings"][number]["action"] = "NEW";
        if (h && !h.deletedAt && h._count.transactions > 0) {
          action = "PRICE_ONLY";
          if (!h.quantity.equals(qty)) preview.warnings.push(`${p.instrumentName}: your transaction history gives ${h.quantity.toString()} units but this statement says ${qty.toString()}. Import the full order history, or check for missing transactions.`);
        } else if (h && !h.deletedAt) {
          action = h.quantity.equals(qty) && h.investedAmount.equals(invested) && (price === null || (h.currentPrice?.equals(price) ?? false)) ? "UNCHANGED" : "UPDATE";
        }
        preview.holdings.push({ name: p.instrumentName, type: p.instrumentType, quantity: qty.toString(), invested: invested.toFixed(2), current: current?.toFixed(2) ?? null, action });
        if (!opts.commit) continue;
        const priceData = price ? { currentPrice: price, currentValue: current!, lastPricedAt: new Date() } : current ? { currentValue: current } : {};
        if (action === "PRICE_ONLY") {
          await tx.investmentHolding.update({ where: { id: h!.id }, data: { ...priceData, ...(price ? { currentValue: roundMoney(h!.quantity.times(price)) } : {}) } });
        } else {
          const data = {
            instrumentName: p.instrumentName, instrumentType: p.instrumentType, isin: p.isin ?? null, symbol: p.symbol ?? null,
            quantity: qty, averageBuyPrice: toDecimal(p.averageBuyPrice), investedAmount: invested, currentPrice: price, currentValue: current ?? invested, deletedAt: null,
            ...(price ? { lastPricedAt: new Date() } : {}),
          };
          if (h) await tx.investmentHolding.update({ where: { id: h.id }, data });
          else await tx.investmentHolding.create({ data: { userId, investmentAccountId: accountId, instrumentKey: key, ...data } });
        }
        if (price) {
          await tx.investmentPrice.upsert({
            where: { instrumentKey_priceDate_source: { instrumentKey: key, priceDate: new Date(new Date().toISOString().slice(0, 10)), source: "GROWW_FILE" } },
            update: { price },
            create: { instrumentKey: key, priceDate: new Date(new Date().toISOString().slice(0, 10)), price, source: "GROWW_FILE" },
          });
        }
      }
      // A holdings statement is the complete list: positions not in it were sold.
      for (const h of existing) {
        if (h.deletedAt || seenKeys.has(h.instrumentKey) || h._count.transactions > 0 || h.quantity.lessThanOrEqualTo(0)) continue;
        preview.removed.push({ name: h.instrumentName, quantity: h.quantity.toString() });
        if (opts.commit && opts.removeMissing !== false) await tx.investmentHolding.update({ where: { id: h.id }, data: { deletedAt: new Date() } });
      }
    } else {
      const ids = parsed.transactions.map((t) => t.externalId);
      const already = new Set(
        (await tx.investmentTransaction.findMany({ where: { userId, sourceType: "GROWW", externalId: { in: ids }, deletedAt: null }, select: { externalId: true } })).map((t) => t.externalId),
      );
      for (const t of parsed.transactions) {
        const dup = already.has(t.externalId);
        preview.transactions.push({ name: t.instrumentName, type: t.type, date: t.tradeDate.toISOString().slice(0, 10), quantity: t.quantity, amount: t.amount, duplicate: dup });
        const key = instrumentKeyOf(t);
        let h = byKey.get(key);
        if (!dup && h && !h.deletedAt && h._count.transactions === 0 && h.quantity.greaterThan(0) && !touched.has(h.id) && !preview.warnings.some((w) => w.startsWith(`${h!.instrumentName}:`))) {
          preview.warnings.push(`${h.instrumentName}: the position you entered (${h.quantity.toString()} units) will be replaced by the imported history.`);
        }
        if (!opts.commit || dup) continue;
        if (!h || h.deletedAt) {
          const data = { instrumentName: t.instrumentName, instrumentType: t.instrumentType ?? "OTHER", isin: t.isin ?? null, symbol: t.symbol ?? null, quantity: 0, averageBuyPrice: 0, investedAmount: 0, realizedGainLoss: 0, currentValue: 0, deletedAt: null };
          const created = h
            ? await tx.investmentHolding.update({ where: { id: h.id }, data })
            : await tx.investmentHolding.create({ data: { userId, investmentAccountId: accountId, instrumentKey: key, ...data } });
          h = { ...created, _count: { transactions: 0 } };
          byKey.set(key, h);
        }
        await tx.investmentTransaction.create({
          data: {
            userId, investmentAccountId: accountId, holdingId: h.id, type: t.type, tradeDate: t.tradeDate, quantity: toDecimal(t.quantity), price: toDecimal(t.price), amount: toDecimal(t.amount),
            charges: toDecimal(t.charges ?? 0), sourceType: "GROWW", externalId: t.externalId,
          },
        });
        touched.add(h.id);
      }
      for (const id of touched) {
        try {
          await recomputeHolding(tx, id);
        } catch (e) {
          if (e instanceof AppError && e.code === "OVERSOLD") {
            throw new AppError(`${e.message} The file seems to start after you bought these units — export the full history (from your first purchase) and try again.`, 422, "INCOMPLETE_HISTORY");
          }
          throw e;
        }
      }
    }
    return preview;
  };

  if (!opts.commit) {
    const preview = await prisma.$transaction(run);
    return { ...preview, committed: false };
  }
  const preview = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "investment_accounts" WHERE id = ${accountId} FOR UPDATE`;
      const p = await run(tx);
      const conn = await tx.growwConnection.upsert({
        where: { investmentAccountId: accountId },
        update: { lastSyncAt: new Date(), status: "ACTIVE", lastError: null },
        create: { userId, investmentAccountId: accountId, method: "FILE_IMPORT", lastSyncAt: new Date() },
      });
      await tx.growwSyncJob.create({
        data: {
          connectionId: conn.id, method: "FILE_IMPORT", status: p.skipped.length ? "PARTIAL" : "SUCCEEDED", fileName: file.name.slice(-120), finishedAt: new Date(),
          holdingsUpserted: p.holdings.filter((h) => h.action !== "UNCHANGED").length, transactionsImported: p.transactions.filter((t) => !t.duplicate).length,
        },
      });
      await audit({ userId, action: AuditAction.INVESTMENT_IMPORTED, entityType: "InvestmentAccount", entityId: accountId, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind: p.kind, holdings: p.holdings.length, transactions: p.transactions.filter((t) => !t.duplicate).length, removed: p.removed.length } }, tx);
      return p;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { ...preview, committed: true };
}
