import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PaymentMethod, SourceType, TransactionType } from "@prisma/client";
import { allowedKindsFor, categorize, type RuleForMatching } from "@/lib/categorization/engine";
import { bestMatch, verdictFor, type DuplicateComparable, type DuplicateVerdict } from "@/lib/duplicates/engine";
import { paymentMethodFrom } from "@/lib/import/classify";
import { extractMerchant, merchantKey, normalizeDescription } from "@/lib/transactions/normalize";
import { toDecimal } from "@/lib/money";
import { collectAffected, emptyAffected, type AffectedAccounts } from "@/services/ledger-balance.service";

/**
 * Shared ingestion pipeline for every automatic source (statements now; email /
 * SMS later). One real-world transaction = one ledger row; every place it was
 * seen becomes a TransactionSource on that row.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | Pick<Prisma.TransactionClient, "transaction" | "creditCard" | "merchant" | "category">;

export const STATEMENT_SOURCES: SourceType[] = ["CSV", "XLSX", "PDF"];
const DAY = 86_400_000;

export type AccountRef = { kind: "bank" | "card"; id: string };

export type IngestRow = {
  account: AccountRef;
  transactionDate: Date;
  transactionAt?: Date | null;
  /** Positive, 2-decimal string. */
  amount: string;
  direction: "DEBIT" | "CREDIT";
  transactionType: TransactionType;
  description: string;
  merchantName: string | null;
  referenceNumber: string | null;
  /** For a bank-side card bill payment: the card it paid (when identifiable). */
  creditCardId?: string | null;
  categoryId: string | null;
  subCategoryId: string | null;
  confidence: number;
};

export function refString(a: AccountRef) {
  return `${a.kind}:${a.id}`;
}

/** Stable fingerprint of a statement row; `occurrence` separates identical rows in one file. */
export function statementFingerprint(account: AccountRef, date: Date, amount: string, direction: string, description: string, occurrence: number) {
  const key = [refString(account), date.toISOString().slice(0, 10), toDecimal(amount).toFixed(2), direction, normalizeDescription(description), occurrence].join("|");
  return createHash("sha256").update(key).digest("hex");
}

const MERCHANT_TYPES: TransactionType[] = ["EXPENSE", "REFUND", "REVERSAL", "FEE", "OTHER"];

export function merchantFor(type: TransactionType, description: string): string | null {
  return MERCHANT_TYPES.includes(type) ? extractMerchant(description) : null;
}

/** "HDFC CC PAYMENT XX1043" → the user's card ending 1043 (only when exactly one matches). */
export async function resolvePaidCard(db: Db, userId: string, description: string): Promise<{ id: string; exact: boolean } | null> {
  const cards = await db.creditCard.findMany({ where: { userId, deletedAt: null }, select: { id: true, last4: true } });
  const digits = new Set(description.match(/\d{4}(?!\d)/g) ?? []);
  const hits = cards.filter((c) => c.last4 && digits.has(c.last4));
  if (hits.length === 1) return { id: hits[0].id, exact: true };
  // Only one card on file → probably that one, but let the user confirm.
  return cards.length === 1 ? { id: cards[0].id, exact: false } : null;
}

async function systemCategory(db: Db, name: string, sub?: string) {
  const cat = await db.category.findFirst({
    where: { userId: null, name, deletedAt: null },
    select: { id: true, subCategories: { where: { name: sub ?? "__none__", deletedAt: null }, select: { id: true } } },
  });
  return cat ? { categoryId: cat.id, subCategoryId: cat.subCategories[0]?.id ?? null } : null;
}

/** Category suggestion: merchant default → user rules → sensible type defaults. */
export async function suggestCategory(
  db: Db,
  userId: string,
  rules: RuleForMatching[],
  row: { transactionType: TransactionType; direction: "DEBIT" | "CREDIT"; description: string; merchantName: string | null; amount: string; account: AccountRef },
): Promise<{ categoryId: string | null; subCategoryId: string | null }> {
  if (row.transactionType === "CARD_PAYMENT") return (await systemCategory(db, "Transfer", "Credit Card Payment")) ?? { categoryId: null, subCategoryId: null };
  if (row.transactionType === "TRANSFER") return (await systemCategory(db, "Transfer", "Own Account")) ?? { categoryId: null, subCategoryId: null };
  const allowed = allowedKindsFor(row.transactionType, row.direction);
  const key = merchantKey(row.merchantName);
  const merchant = key ? await db.merchant.findUnique({ where: { userId_normalizedName: { userId, normalizedName: key } } }) : null;
  const defaultCat = merchant?.defaultCategoryId
    ? await db.category.findFirst({ where: { id: merchant.defaultCategoryId, deletedAt: null }, select: { kind: true } })
    : null;
  const hit = categorize(
    { description: row.description, merchantName: merchant?.name ?? row.merchantName, amount: row.amount, direction: row.direction, allowedKinds: allowed },
    rules,
    merchant && defaultCat ? { categoryId: merchant.defaultCategoryId, subCategoryId: merchant.defaultSubCategoryId, categoryKind: defaultCat.kind } : null,
  );
  if (hit) return { categoryId: hit.categoryId, subCategoryId: hit.subCategoryId };
  const fallback: Partial<Record<TransactionType, [string, string?]>> = {
    EMI: ["EMI"],
    INVESTMENT: ["Investment", "SIP"],
    ATM_WITHDRAWAL: ["Other", "Cash Withdrawal"],
    FEE: ["Fees & Charges", row.account.kind === "card" ? "Card Fees" : "Bank Charges"],
    INTEREST: ["Interest", "Savings Interest"],
  };
  const f = fallback[row.transactionType];
  return (f && (await systemCategory(db, f[0], f[1]))) || { categoryId: null, subCategoryId: null };
}

// ───────────────────────────── duplicate lookup ─────────────────────────────

const candidateSelect = {
  id: true,
  bankAccountId: true,
  creditCardId: true,
  cashAccountId: true,
  transactionDate: true,
  transactionAt: true,
  amount: true,
  direction: true,
  currency: true,
  referenceNumber: true,
  merchantName: true,
  description: true,
  transactionType: true,
  status: true,
} satisfies Prisma.TransactionSelect;

type Candidate = Prisma.TransactionGetPayload<{ select: typeof candidateSelect }>;

export function comparableOf(t: Candidate): DuplicateComparable {
  const refs: string[] = [];
  if (t.bankAccountId) refs.push(`bank:${t.bankAccountId}`);
  if (t.creditCardId) refs.push(`card:${t.creditCardId}`);
  if (t.cashAccountId) refs.push(`cash:${t.cashAccountId}`);
  return {
    accountRefs: refs,
    transactionDate: t.transactionDate,
    transactionAt: t.transactionAt,
    amount: t.amount,
    direction: t.direction,
    currency: t.currency,
    referenceNumber: t.referenceNumber,
    merchantName: t.merchantName,
    description: t.description,
    isCardPayment: t.transactionType === "CARD_PAYMENT",
  };
}

export function comparableOfRow(row: IngestRow): DuplicateComparable {
  const refs = [refString(row.account)];
  if (row.creditCardId) refs.push(`card:${row.creditCardId}`);
  return {
    accountRefs: refs,
    transactionDate: row.transactionDate,
    transactionAt: row.transactionAt,
    amount: row.amount,
    direction: row.direction,
    currency: "INR",
    referenceNumber: row.referenceNumber,
    merchantName: row.merchantName,
    description: row.description,
    isCardPayment: row.transactionType === "CARD_PAYMENT",
  };
}

export type DuplicateHit = { transactionId: string; score: number; matchedFields: string[]; verdict: DuplicateVerdict };

/**
 * Best existing ledger match for an incoming row. `claimed` = transactions an
 * earlier row of the same batch already auto-matched (one statement line can't
 * be two ledger rows' twin). A transaction that already came from a statement
 * of the SAME account is a different statement line, so it's capped at review.
 */
export async function findDuplicate(
  db: Db,
  userId: string,
  row: IngestRow,
  claimed: Set<string> = new Set(),
  /** Sources of the SAME channel as the incoming row (e.g. this account's statements, or any email alert): a match that already has one is a different real transaction. */
  sameChannel: Prisma.TransactionSourceWhereInput = { sourceType: { in: STATEMENT_SOURCES }, metadata: { path: ["account"], equals: refString(row.account) } },
): Promise<DuplicateHit | null> {
  const accountOr: Prisma.TransactionWhereInput[] = [row.account.kind === "bank" ? { bankAccountId: row.account.id } : { creditCardId: row.account.id }];
  if (row.creditCardId) accountOr.push({ creditCardId: row.creditCardId, transactionType: "CARD_PAYMENT" });
  const candidates = await db.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      duplicateOfId: null,
      status: { not: "REJECTED" },
      amount: toDecimal(row.amount),
      transactionDate: { gte: new Date(row.transactionDate.getTime() - 3 * DAY), lte: new Date(row.transactionDate.getTime() + 3 * DAY) },
      OR: accountOr,
    },
    select: candidateSelect,
    take: 50,
  });
  if (!candidates.length) return null;
  const best = bestMatch(
    comparableOfRow(row),
    candidates.map((c) => ({ item: c, comparable: comparableOf(c) })),
  );
  if (!best) return null;
  let verdict = verdictFor(best.result.score);
  if (verdict === "UNIQUE") return null;
  if (verdict === "AUTO_MATCH") {
    const sameAccountStatement = await db.transaction.count({
      where: {
        id: best.item.id,
        sources: { some: sameChannel },
      },
    });
    if (sameAccountStatement || claimed.has(best.item.id)) verdict = "REVIEW";
  }
  return { transactionId: best.item.id, score: best.result.score, matchedFields: best.result.matchedFields, verdict };
}

// ───────────────────────────── writes ─────────────────────────────

async function upsertMerchant(tx: Tx, userId: string, name: string | null) {
  const key = merchantKey(name);
  if (!name || !key) return null;
  await tx.merchant.createMany({ data: [{ userId, name: name.trim().slice(0, 120), normalizedName: key }], skipDuplicates: true });
  return tx.merchant.findUniqueOrThrow({ where: { userId_normalizedName: { userId, normalizedName: key } } });
}

function columnsFor(row: IngestRow) {
  return {
    bankAccountId: row.account.kind === "bank" ? row.account.id : null,
    creditCardId: row.account.kind === "card" ? row.account.id : row.transactionType === "CARD_PAYMENT" ? (row.creditCardId ?? null) : null,
    cashAccountId: null,
  };
}

export type SourceInfo = {
  sourceType: SourceType;
  externalId: string | null;
  importId?: string | null;
  importRowId?: string | null;
  emailMessageId?: string | null;
  rawDescription: string;
  confidence: number;
  metadata?: Prisma.InputJsonObject;
};

/** Writes a brand-new ledger row from an ingested record (+ detail row + source). */
export async function createIngestedTransaction(
  tx: Tx,
  userId: string,
  row: IngestRow,
  state: { status: "CONFIRMED" | "PENDING_REVIEW"; duplicateStatus: "UNIQUE" | "POSSIBLE_DUPLICATE" },
  source: SourceInfo,
) {
  const merchant = await upsertMerchant(tx, userId, row.merchantName);
  const t = await tx.transaction.create({
    data: {
      userId,
      ...columnsFor(row),
      transactionDate: row.transactionDate,
      transactionAt: row.transactionAt ?? null,
      amount: toDecimal(row.amount),
      direction: row.direction,
      transactionType: row.transactionType,
      status: state.status,
      duplicateStatus: state.duplicateStatus,
      currency: "INR",
      merchantId: merchant?.id ?? null,
      merchantName: merchant?.name ?? row.merchantName,
      description: row.description.slice(0, 300),
      normalizedDescription: normalizeDescription(row.description),
      categoryId: row.categoryId,
      subCategoryId: row.subCategoryId,
      referenceNumber: row.referenceNumber,
      sourceType: source.sourceType,
      importId: source.importId ?? null,
      confidenceScore: row.confidence,
    },
  });
  await addSource(tx, userId, t.id, row, source);

  const isIncome = row.direction === "CREDIT" && (row.transactionType === "INCOME" || row.transactionType === "INTEREST");
  const isExpense = row.direction === "DEBIT" && ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"].includes(row.transactionType);
  if (isIncome) {
    await tx.income.create({ data: { userId, transactionId: t.id, incomeCategory: row.transactionType === "INTEREST" ? "INTEREST" : /SALARY|SAL\b|PAYROLL/i.test(row.description) ? "SALARY" : "OTHER" } });
  }
  if (isExpense) {
    const cat = row.categoryId ? await tx.category.findUnique({ where: { id: row.categoryId }, select: { isFixed: true } }) : null;
    await tx.expense.create({
      data: { userId, transactionId: t.id, paymentMethod: paymentMethodFrom(row.description, row.account.kind) as PaymentMethod, isDiscretionary: !(cat?.isFixed ?? false) },
    });
  }
  return t;
}

async function addSource(tx: Tx, userId: string, transactionId: string, row: IngestRow, s: SourceInfo, extraMeta: Prisma.InputJsonObject = {}) {
  return tx.transactionSource.create({
    data: {
      userId,
      transactionId,
      sourceType: s.sourceType,
      externalId: s.externalId,
      importId: s.importId ?? null,
      importRowId: s.importRowId ?? null,
      emailMessageId: s.emailMessageId ?? null,
      rawDescription: s.rawDescription.slice(0, 500),
      rawAmount: toDecimal(row.amount),
      confidenceScore: s.confidence,
      metadata: { account: refString(row.account), ...(s.metadata ?? {}), ...extraMeta },
    },
  });
}

/**
 * High-confidence duplicate: record where else we saw it and fill fields the
 * existing row is missing (never overwrite what the user entered). A bank-side
 * card payment matched to a card-side one gains its bank account (and vice versa).
 * Returns the accounts whose balances must be recomputed.
 */
export async function attachToExisting(tx: Tx, userId: string, existingId: string, row: IngestRow, source: SourceInfo): Promise<AffectedAccounts> {
  const t = await tx.transaction.findFirstOrThrow({ where: { id: existingId, userId, deletedAt: null } });
  const fill: Prisma.TransactionUncheckedUpdateInput = {};
  const filled: string[] = [];
  if (!t.referenceNumber && row.referenceNumber) {
    fill.referenceNumber = row.referenceNumber;
    filled.push("referenceNumber");
  }
  if (!t.transactionAt && row.transactionAt) {
    fill.transactionAt = row.transactionAt;
    filled.push("transactionAt");
  }
  if (t.transactionType === "CARD_PAYMENT") {
    if (!t.bankAccountId && !t.cashAccountId && row.account.kind === "bank") {
      fill.bankAccountId = row.account.id;
      filled.push("bankAccountId");
    }
    if (!t.creditCardId && (row.account.kind === "card" || row.creditCardId)) {
      fill.creditCardId = row.account.kind === "card" ? row.account.id : row.creditCardId!;
      filled.push("creditCardId");
    }
    // The ledger stores a card payment as the bank's debit.
    if (fill.bankAccountId && t.direction === "CREDIT") {
      fill.direction = "DEBIT";
      filled.push("direction");
    }
  }
  const affected = emptyAffected();
  collectAffected(affected, t);
  if (filled.length) {
    const updated = await tx.transaction.update({ where: { id: t.id }, data: fill });
    collectAffected(affected, updated);
  }
  const previous: Record<string, string | null> = { direction: t.direction };
  for (const f of filled) if (f !== "direction") previous[f] = null;
  await addSource(tx, userId, t.id, row, source, { filled, previous });
  return affected;
}

export type SourceFillMeta = {
  /** Fields this source filled on its own transaction. */
  filled?: string[];
  /** Set when the fill happened on a DIFFERENT transaction (duplicate confirmed onto an original). */
  filledOn?: string;
  previous?: Record<string, unknown>;
};

const REVERTIBLE = new Set(["referenceNumber", "transactionAt", "bankAccountId", "creditCardId", "direction", "categoryId", "subCategoryId", "merchantId", "merchantName"]);

/** Put back the values a source overwrote (null when nothing was there). */
export async function revertFill(tx: Tx, transactionId: string, filled: string[] = [], previous: Record<string, unknown> = {}): Promise<AffectedAccounts> {
  const affected = emptyAffected();
  const t = await tx.transaction.findUnique({ where: { id: transactionId } });
  if (!t || !filled.length) return affected;
  collectAffected(affected, t);
  const data: Record<string, unknown> = {};
  for (const f of filled) {
    if (!REVERTIBLE.has(f)) continue;
    if (f === "direction") {
      if (previous.direction === "DEBIT" || previous.direction === "CREDIT") data.direction = previous.direction;
    } else data[f] = previous[f] ?? null;
  }
  if (Object.keys(data).length) await tx.transaction.update({ where: { id: transactionId }, data: data as Prisma.TransactionUncheckedUpdateInput });
  return affected;
}

/** Undo of attachToExisting: drop the source and clear what it filled in. */
export async function detachSource(tx: Tx, sourceId: string): Promise<AffectedAccounts> {
  const s = await tx.transactionSource.findUniqueOrThrow({ where: { id: sourceId }, include: { transaction: true } });
  const meta = (s.metadata ?? {}) as SourceFillMeta;
  const affected = emptyAffected();
  collectAffected(affected, s.transaction);
  if (!meta.filledOn) {
    const a = await revertFill(tx, s.transactionId, meta.filled, meta.previous);
    a.bank.forEach((x) => affected.bank.add(x));
    a.card.forEach((x) => affected.card.add(x));
  }
  await tx.transactionSource.delete({ where: { id: s.id } });
  return affected;
}

/**
 * Before a transaction disappears, the rows that were hidden as its duplicates
 * must not vanish with it: the oldest becomes the visible record again (so the
 * real-world transaction is still counted exactly once).
 */
export async function promoteDuplicatesOf(tx: Tx, transactionId: string): Promise<AffectedAccounts> {
  const affected = emptyAffected();
  const dups = await tx.transaction.findMany({ where: { duplicateOfId: transactionId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (!dups.length) return affected;
  const [first, ...rest] = dups;
  await tx.transaction.update({ where: { id: first.id }, data: { duplicateOfId: null, duplicateStatus: "UNIQUE" } });
  if (rest.length) await tx.transaction.updateMany({ where: { id: { in: rest.map((d) => d.id) } }, data: { duplicateOfId: first.id } });
  collectAffected(affected, first);
  return affected;
}
