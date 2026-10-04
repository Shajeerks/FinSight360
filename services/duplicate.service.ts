import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { scoreDuplicate, REVIEW_THRESHOLD } from "@/lib/duplicates/engine";
import { duplicateActionSchema, reviewActionSchema } from "@/validators/imports";
import { collectAffected, emptyAffected, lockForWrite, recomputeAffected } from "@/services/ledger-balance.service";
import { comparableOf, STATEMENT_SOURCES } from "@/services/ingestion.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

const pairInclude = {
  bankAccount: { select: { nickname: true, bankName: true, last4: true } },
  creditCard: { select: { cardName: true, bankName: true, last4: true } },
  cashAccount: { select: { name: true } },
  category: { select: { name: true, color: true } },
  sources: { select: { sourceType: true, receivedAt: true, rawDescription: true }, orderBy: { receivedAt: "asc" } },
} satisfies Prisma.TransactionInclude;

export async function listDuplicateCandidates(userId: string) {
  return prisma.transactionDuplicateCandidate.findMany({
    where: { userId, status: "PENDING", transaction: { deletedAt: null }, matchedTransaction: { deletedAt: null } },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { transaction: { include: pairInclude }, matchedTransaction: { include: pairInclude } },
  });
}

export type DuplicatePair = Awaited<ReturnType<typeof listDuplicateCandidates>>[number];

export async function countPending(userId: string) {
  const [duplicates, review] = await Promise.all([
    prisma.transactionDuplicateCandidate.count({ where: { userId, status: "PENDING", transaction: { deletedAt: null }, matchedTransaction: { deletedAt: null } } }),
    prisma.transaction.count({ where: reviewWhere(userId) }),
  ]);
  return { duplicates, review };
}

/**
 * Resolve a possible-duplicate pair (spec §10):
 *  CONFIRM_DUPLICATE — the newer row is the same transaction: hide it (kept for audit, never counted)
 *  MERGE             — same, and also move its sources + fill missing fields into the original
 *  KEEP_BOTH         — they're different transactions: the newer one is confirmed and counts
 *  IGNORE            — dismiss the duplicate warning; the row stays in the review queue
 */
export async function resolveDuplicate(userId: string, candidateId: string, input: unknown, meta: RequestMeta = NO_META) {
  const { action } = parseOrThrow(duplicateActionSchema, input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "transaction_duplicate_candidates" WHERE id = ${candidateId} FOR UPDATE`;
    const c = await tx.transactionDuplicateCandidate.findFirst({ where: { id: candidateId, userId }, include: { transaction: true, matchedTransaction: true } });
    if (!c) throw new NotFoundError("Duplicate not found.");
    if (c.status !== "PENDING") throw new AppError("This duplicate was already resolved.", 409, "ALREADY_RESOLVED");
    const dup = c.transaction;
    const original = c.matchedTransaction;
    if (dup.deletedAt || original.deletedAt) throw new AppError("One of these transactions was deleted.", 409, "GONE");
    const affected = emptyAffected();
    collectAffected(affected, dup);
    collectAffected(affected, original);
    await lockForWrite(tx, affected);

    const now = new Date();
    if (action === "CONFIRM_DUPLICATE" || action === "MERGE") {
      if (original.duplicateOfId) throw new AppError("The matched transaction is itself a duplicate — resolve that first.", 409, "CHAINED_DUPLICATE");
      // Fields the original is missing. For a card bill payment the account side is
      // ALWAYS carried over (otherwise hiding the bank-side row would drop the bank
      // debit); MERGE also carries reference / time / category / merchant.
      const fill: Record<string, unknown> = {};
      if (original.transactionType === "CARD_PAYMENT") {
        if (!original.bankAccountId && !original.cashAccountId && dup.bankAccountId) Object.assign(fill, { bankAccountId: dup.bankAccountId, direction: "DEBIT" });
        if (!original.creditCardId && dup.creditCardId) fill.creditCardId = dup.creditCardId;
      }
      if (action === "MERGE") {
        if (!original.referenceNumber && dup.referenceNumber) fill.referenceNumber = dup.referenceNumber;
        if (!original.transactionAt && dup.transactionAt) fill.transactionAt = dup.transactionAt;
        if (!original.categoryId && dup.categoryId) Object.assign(fill, { categoryId: dup.categoryId, subCategoryId: dup.subCategoryId });
        if (!original.merchantId && dup.merchantId) Object.assign(fill, { merchantId: dup.merchantId, merchantName: dup.merchantName });
      }
      const filled = Object.keys(fill);
      const previous: Record<string, unknown> = {};
      for (const f of filled) previous[f] = (original as Record<string, unknown>)[f] ?? null;
      if (filled.length) {
        collectAffected(affected, fill as { bankAccountId?: string; creditCardId?: string });
        await lockForWrite(tx, affected);
        await tx.transaction.update({ where: { id: original.id }, data: fill as Prisma.TransactionUncheckedUpdateInput });
      }
      // Remember the fill on the duplicate's sources so undoing its import reverses it.
      const dupSources = await tx.transactionSource.findMany({ where: { transactionId: dup.id } });
      for (const src of dupSources) {
        const base = (src.metadata ?? {}) as Record<string, unknown>;
        const metadata = action === "MERGE"
          ? { ...base, filled, previous } // the source moves onto the original
          : { ...base, filledOn: original.id, filled, previous };
        await tx.transactionSource.update({
          where: { id: src.id },
          data: { metadata: metadata as Prisma.InputJsonObject, ...(action === "MERGE" ? { transactionId: original.id } : {}) },
        });
      }
      await tx.transaction.update({
        where: { id: dup.id },
        data: { duplicateOfId: original.id, duplicateStatus: action === "MERGE" ? "MERGED" : "DUPLICATE", status: "CONFIRMED" },
      });
      // Rows that were hidden as duplicates of the newer row now point at the original.
      await tx.transaction.updateMany({ where: { duplicateOfId: dup.id }, data: { duplicateOfId: original.id } });
      await tx.transaction.update({ where: { id: original.id }, data: { duplicateStatus: "UNIQUE" } });
      await tx.transactionDuplicateCandidate.update({ where: { id: c.id }, data: { status: action === "MERGE" ? "MERGED" : "CONFIRMED_DUPLICATE", resolvedAt: now } });
      await tx.transactionDuplicateCandidate.updateMany({ where: { transactionId: dup.id, status: "PENDING", id: { not: c.id } }, data: { status: "IGNORED", resolvedAt: now } });
    } else if (action === "KEEP_BOTH") {
      const stillPending = await tx.transactionDuplicateCandidate.count({ where: { transactionId: dup.id, status: "PENDING", id: { not: c.id } } });
      await tx.transaction.update({
        where: { id: dup.id },
        data: { duplicateStatus: stillPending ? "POSSIBLE_DUPLICATE" : "UNIQUE", status: stillPending ? dup.status : "CONFIRMED" },
      });
      await tx.transactionDuplicateCandidate.update({ where: { id: c.id }, data: { status: "KEPT_BOTH", resolvedAt: now } });
    } else {
      const stillPending = await tx.transactionDuplicateCandidate.count({ where: { transactionId: dup.id, status: "PENDING", id: { not: c.id } } });
      if (!stillPending) await tx.transaction.update({ where: { id: dup.id }, data: { duplicateStatus: "UNIQUE" } });
      await tx.transactionDuplicateCandidate.update({ where: { id: c.id }, data: { status: "IGNORED", resolvedAt: now } });
    }
    await recomputeAffected(tx, affected);
    await audit({ userId, action: AuditAction.DUPLICATE_RESOLVED, entityType: "Transaction", entityId: dup.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { action, matched: original.id, score: c.score.toString() } }, tx);
    return { action };
  });
}

/**
 * Scan recent confirmed transactions for pairs that look like the same
 * transaction (e.g. a manual entry + an email alert). Flags the newer one;
 * nothing is hidden until the user decides.
 */
export async function scanForDuplicates(userId: string, days = 120, meta: RequestMeta = NO_META) {
  const since = new Date(Date.now() - days * 86_400_000);
  const txns = await prisma.transaction.findMany({
    where: { userId, deletedAt: null, duplicateOfId: null, status: { not: "REJECTED" }, transactionDate: { gte: since } },
    select: {
      id: true, bankAccountId: true, creditCardId: true, cashAccountId: true, transactionDate: true, transactionAt: true, amount: true, direction: true,
      currency: true, referenceNumber: true, merchantName: true, description: true, transactionType: true, status: true, transferGroupId: true, createdAt: true,
      sources: { select: { sourceType: true, metadata: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const existing = await prisma.transactionDuplicateCandidate.findMany({ where: { userId }, select: { transactionId: true, matchedTransactionId: true } });
  const known = new Set(existing.flatMap((e) => [`${e.transactionId}|${e.matchedTransactionId}`, `${e.matchedTransactionId}|${e.transactionId}`]));
  const byAmount = new Map<string, typeof txns>();
  for (const t of txns) {
    const k = t.amount.toFixed(2);
    byAmount.set(k, [...(byAmount.get(k) ?? []), t]);
  }
  const statementAccount = (t: (typeof txns)[number]) =>
    new Set(t.sources.filter((s) => STATEMENT_SOURCES.includes(s.sourceType)).map((s) => (s.metadata as { account?: string } | null)?.account).filter(Boolean));
  let flagged = 0;
  for (const group of byAmount.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [older, newer] = [group[i], group[j]];
        if (older.transferGroupId && older.transferGroupId === newer.transferGroupId) continue;
        if (known.has(`${newer.id}|${older.id}`)) continue;
        // Two rows of the same account's statements are two real transactions.
        const sa = statementAccount(older);
        if ([...statementAccount(newer)].some((a) => sa.has(a))) continue;
        // Two plain manual entries are the user's own deliberate records.
        if (older.sources.every((s) => s.sourceType === "MANUAL") && newer.sources.every((s) => s.sourceType === "MANUAL")) continue;
        const res = scoreDuplicate(comparableOf(newer), comparableOf(older));
        if (res.score < REVIEW_THRESHOLD) continue;
        await prisma.$transaction([
          prisma.transactionDuplicateCandidate.create({ data: { userId, transactionId: newer.id, matchedTransactionId: older.id, score: res.score, matchedFields: res.matchedFields } }),
          prisma.transaction.update({ where: { id: newer.id }, data: { duplicateStatus: "POSSIBLE_DUPLICATE" } }),
        ]);
        known.add(`${newer.id}|${older.id}`).add(`${older.id}|${newer.id}`);
        flagged++;
      }
    }
  }
  await audit({ userId, action: "duplicate.scan", entityType: "Transaction", ip: meta.ip, userAgent: meta.userAgent, metadata: { scanned: txns.length, flagged, days } });
  return { scanned: txns.length, flagged };
}

// ───────────────────────────── review queue ─────────────────────────────

function reviewWhere(userId: string): Prisma.TransactionWhereInput {
  return { userId, deletedAt: null, status: "PENDING_REVIEW", duplicateOfId: null, duplicateCandidates: { none: { status: "PENDING" } } };
}

export async function listReviewQueue(userId: string) {
  return prisma.transaction.findMany({
    where: reviewWhere(userId),
    orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { ...pairInclude, import: { select: { id: true, fileName: true } } },
  });
}

export type ReviewItem = Awaited<ReturnType<typeof listReviewQueue>>[number];

/** Approve (starts counting) or reject (kept for audit, never counted) pending transactions. */
export async function resolveReview(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const { action, ids } = parseOrThrow(reviewActionSchema, input);
  return prisma.$transaction(async (tx: Tx) => {
    const rows = await tx.transaction.findMany({ where: { id: { in: ids }, userId, deletedAt: null, status: "PENDING_REVIEW" } });
    if (!rows.length) throw new AppError("Nothing to update — these were already reviewed.", 409, "ALREADY_RESOLVED");
    const legs = rows.some((r) => r.transferGroupId)
      ? await tx.transaction.findMany({ where: { userId, deletedAt: null, transferGroupId: { in: rows.map((r) => r.transferGroupId).filter((x): x is string => Boolean(x)) } } })
      : [];
    const all = [...new Map([...rows, ...legs].map((r) => [r.id, r])).values()];
    const affected = emptyAffected();
    all.forEach((r) => collectAffected(affected, r));
    await lockForWrite(tx, affected);
    const now = new Date();
    if (action === "APPROVE") {
      await tx.transaction.updateMany({ where: { id: { in: all.map((r) => r.id) } }, data: { status: "CONFIRMED", duplicateStatus: "UNIQUE" } });
      await tx.transactionDuplicateCandidate.updateMany({ where: { transactionId: { in: all.map((r) => r.id) }, status: "PENDING" }, data: { status: "KEPT_BOTH", resolvedAt: now } });
    } else {
      await tx.transaction.updateMany({ where: { id: { in: all.map((r) => r.id) } }, data: { status: "REJECTED" } });
      await tx.transactionDuplicateCandidate.updateMany({ where: { transactionId: { in: all.map((r) => r.id) }, status: "PENDING" }, data: { status: "IGNORED", resolvedAt: now } });
    }
    await recomputeAffected(tx, affected);
    await audit({ userId, action: AuditAction.REVIEW_RESOLVED, entityType: "Transaction", ip: meta.ip, userAgent: meta.userAgent, metadata: { action, count: all.length, ids: all.map((r) => r.id).slice(0, 50) } }, tx);
    return { count: rows.length };
  });
}
