import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, PaymentMethod, TransactionType, TransactionDirection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { allowedKindsFor, categorize } from "@/lib/categorization/engine";
import { extractMerchant, merchantKey, normalizeDescription } from "@/lib/transactions/normalize";
import { KIND_SPECS, kindOf, parseAccountRef, type TransactionKind } from "@/lib/transactions/kinds";
import { countableWhere } from "@/lib/transactions/countable";
import { roundMoney, toDecimal } from "@/lib/money";
import { transactionSchema, type TransactionData, type TransactionFilters } from "@/validators/transactions";
import { assertAccountRef } from "@/services/account.service";
import { assertCategory } from "@/services/category.service";
import { loadRulesForMatching } from "@/services/rule.service";
import { collectAffected, emptyAffected, lockForWrite, recomputeAffected } from "@/services/ledger-balance.service";
import { promoteDuplicatesOf } from "@/services/ingestion.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

export const PAGE_SIZE = 50;

const AUTO_MERCHANT_KINDS: TransactionKind[] = ["EXPENSE", "REFUND", "REVERSAL", "FEE", "OTHER_DEBIT"];

// ───────────────────────────── helpers ─────────────────────────────

function accountColumns(ref: { kind: "bank" | "card" | "cash"; id: string }) {
  return {
    bankAccountId: ref.kind === "bank" ? ref.id : null,
    creditCardId: ref.kind === "card" ? ref.id : null,
    cashAccountId: ref.kind === "cash" ? ref.id : null,
  };
}

function defaultPaymentMethod(kind: "bank" | "card" | "cash"): PaymentMethod {
  return kind === "card" ? "CREDIT_CARD" : kind === "cash" ? "CASH" : "UPI";
}

async function systemCategory(tx: Tx, kind: "TRANSFER", name: string, sub: string) {
  const cat = await tx.category.findFirst({ where: { userId: null, kind, name, deletedAt: null }, include: { subCategories: { where: { name: sub } } } });
  return { categoryId: cat?.id ?? null, subCategoryId: cat?.subCategories[0]?.id ?? null };
}

async function upsertMerchant(tx: Tx, userId: string, name: string | null) {
  const key = merchantKey(name);
  if (!name || !key) return null;
  // INSERT … ON CONFLICT DO NOTHING — safe when two transactions create the same merchant at once.
  await tx.merchant.createMany({ data: [{ userId, name: name.trim().slice(0, 120), normalizedName: key }], skipDuplicates: true });
  return tx.merchant.findUniqueOrThrow({ where: { userId_normalizedName: { userId, normalizedName: key } } });
}

/** "Apply this category to future transactions from this merchant" (§24). */
export async function learnMerchantCategory(tx: Tx, userId: string, merchantId: string, categoryId: string, subCategoryId: string | null) {
  const merchant = await tx.merchant.update({
    where: { id: merchantId },
    data: { defaultCategoryId: categoryId, defaultSubCategoryId: subCategoryId },
  });
  const existing = await tx.categorizationRule.findFirst({ where: { userId, matchType: "MERCHANT", pattern: merchant.normalizedName } });
  if (existing) {
    await tx.categorizationRule.update({ where: { id: existing.id }, data: { categoryId, subCategoryId, isActive: true, merchantId } });
  } else {
    await tx.categorizationRule.create({
      data: { userId, name: `${merchant.name} (learned)`, matchType: "MERCHANT", pattern: merchant.normalizedName, merchantId, categoryId, subCategoryId, priority: 10 },
    });
  }
}

type Resolved = {
  spec: (typeof KIND_SPECS)[TransactionKind];
  from: { kind: "bank" | "card" | "cash"; id: string };
  to: { kind: "bank" | "card" | "cash"; id: string } | null;
  merchantId: string | null;
  merchantName: string | null;
  categoryId: string | null;
  subCategoryId: string | null;
};

/** Validates ownership of every referenced record and decides merchant + category. */
async function resolve(tx: Tx, userId: string, data: TransactionData, existingRefs: Set<string> = new Set()): Promise<Resolved> {
  const spec = KIND_SPECS[data.kind];
  const check = (ref: { kind: "bank" | "card" | "cash"; id: string }) =>
    assertAccountRef(tx, userId, ref, { allowRemoved: existingRefs.has(`${ref.kind}:${ref.id}`) });
  const from = parseAccountRef(data.account)!;
  await check(from);
  let to: Resolved["to"] = null;
  if (data.kind === "TRANSFER") {
    to = parseAccountRef(data.toAccount)!;
    await check(to);
  }
  if (data.kind === "CARD_PAYMENT") {
    to = { kind: "card", id: data.creditCardId! };
    await check(to);
  }

  const allowed = allowedKindsFor(spec.type, spec.direction);
  let categoryId = data.categoryId;
  let subCategoryId = data.subCategoryId;
  if (categoryId) {
    const cat = await assertCategory(tx, userId, categoryId, subCategoryId);
    if (cat && !allowed.includes(cat.kind)) {
      throw new AppError(`A ${cat.kind.toLowerCase()} category can't be used for this transaction.`, 400, "INVALID_CATEGORY", {
        categoryId: [`Choose a ${allowed[0].toLowerCase()} category`],
      });
    }
  }

  const merchantName = data.merchantName ?? (AUTO_MERCHANT_KINDS.includes(data.kind) ? extractMerchant(data.description) : null);
  const merchant = await upsertMerchant(tx, userId, merchantName);

  if (!categoryId) {
    if (data.kind === "TRANSFER") ({ categoryId, subCategoryId } = await systemCategory(tx, "TRANSFER", "Transfer", "Own Account"));
    else if (data.kind === "CARD_PAYMENT") ({ categoryId, subCategoryId } = await systemCategory(tx, "TRANSFER", "Transfer", "Credit Card Payment"));
    else {
      const defaultCat = merchant?.defaultCategoryId
        ? await tx.category.findFirst({ where: { id: merchant.defaultCategoryId, deletedAt: null }, select: { kind: true } })
        : null;
      const res = categorize(
        { description: data.description, merchantName: merchant?.name ?? merchantName, amount: data.amount, direction: spec.direction, allowedKinds: allowed },
        await loadRulesForMatching(tx, userId),
        merchant && defaultCat ? { categoryId: merchant.defaultCategoryId, subCategoryId: merchant.defaultSubCategoryId, categoryKind: defaultCat.kind } : null,
      );
      if (res) ({ categoryId, subCategoryId } = res);
    }
  }

  return { spec, from, to, merchantId: merchant?.id ?? null, merchantName: merchant?.name ?? merchantName, categoryId, subCategoryId };
}

function refsAffected(r: Resolved) {
  const a = emptyAffected();
  for (const ref of [r.from, r.to]) {
    if (!ref) continue;
    if (ref.kind === "bank") a.bank.add(ref.id);
    else if (ref.kind === "card") a.card.add(ref.id);
    else a.cash.add(ref.id);
  }
  return a;
}

function baseFields(data: TransactionData, r: Resolved) {
  return {
    transactionDate: data.transactionDate,
    amount: roundMoney(data.amount),
    transactionType: r.spec.type as TransactionType,
    currency: "INR",
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    description: data.description,
    normalizedDescription: normalizeDescription(data.description),
    categoryId: r.categoryId,
    subCategoryId: r.subCategoryId,
    referenceNumber: data.referenceNumber,
    notes: data.notes,
  };
}

async function writeDetailRows(tx: Tx, userId: string, transactionId: string, data: TransactionData, r: Resolved) {
  const isIncome = r.spec.direction === "CREDIT" && (r.spec.type === "INCOME" || r.spec.type === "INTEREST");
  const isExpense = r.spec.direction === "DEBIT" && ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"].includes(r.spec.type);
  if (isIncome) {
    const incomeCategory = r.spec.type === "INTEREST" ? "INTEREST" : (data.incomeCategory ?? "OTHER");
    await tx.income.upsert({
      where: { transactionId },
      update: { incomeCategory, sourceName: data.sourceName, isRecurring: data.isRecurring },
      create: { userId, transactionId, incomeCategory, sourceName: data.sourceName, isRecurring: data.isRecurring },
    });
  } else {
    await tx.income.deleteMany({ where: { transactionId } });
  }
  if (isExpense) {
    const paymentMethod = data.paymentMethod ?? defaultPaymentMethod(r.from.kind);
    const cat = r.categoryId ? await tx.category.findUnique({ where: { id: r.categoryId }, select: { isFixed: true } }) : null;
    await tx.expense.upsert({
      where: { transactionId },
      update: { paymentMethod, isRecurring: data.isRecurring, isDiscretionary: !(cat?.isFixed ?? false) },
      create: { userId, transactionId, paymentMethod, isRecurring: data.isRecurring, isDiscretionary: !(cat?.isFixed ?? false) },
    });
  } else {
    await tx.expense.deleteMany({ where: { transactionId } });
  }
}

/** Creates the ledger row(s). A transfer is stored as two linked legs. */
type CarryOver = Partial<Pick<Prisma.TransactionUncheckedCreateInput, "status" | "sourceType" | "duplicateStatus" | "duplicateOfId" | "importId" | "confidenceScore">>;

async function insertLegs(tx: Tx, userId: string, data: TransactionData, r: Resolved, carry: CarryOver = {}) {
  const base = baseFields(data, r);
  const common = { userId, ...base, status: "CONFIRMED" as const, sourceType: "MANUAL" as const, duplicateStatus: "UNIQUE" as const, ...carry };
  const created = [];
  if (data.kind === "TRANSFER" && r.to) {
    const transferGroupId = randomUUID();
    created.push(await tx.transaction.create({ data: { ...common, ...accountColumns(r.from), direction: "DEBIT", transferGroupId } }));
    created.push(await tx.transaction.create({ data: { ...common, ...accountColumns(r.to), direction: "CREDIT", transferGroupId } }));
  } else {
    const cols = accountColumns(r.from);
    if (data.kind === "CARD_PAYMENT" && r.to) cols.creditCardId = r.to.id;
    created.push(await tx.transaction.create({ data: { ...common, ...cols, direction: r.spec.direction as TransactionDirection } }));
  }
  if (!carry.sourceType) {
    for (const t of created) {
      await tx.transactionSource.create({ data: { userId, transactionId: t.id, sourceType: "MANUAL", rawDescription: data.description, rawAmount: t.amount } });
    }
  }
  await writeDetailRows(tx, userId, created[0].id, data, r);
  return created;
}

// ───────────────────────────── commands ─────────────────────────────

export async function createTransaction(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  return prisma.$transaction((tx) => createTransactionWithin(tx, userId, input, meta));
}

/**
 * Same as createTransaction but inside an existing DB transaction (used by the
 * loan module so an EMI payment and its ledger entry commit atomically).
 */
export async function createTransactionWithin(tx: Tx, userId: string, input: unknown, meta: RequestMeta = NO_META, extra: { loanId?: string } = {}) {
  const data = parseOrThrow(transactionSchema, input);
  const r = await resolve(tx, userId, data);
  await lockForWrite(tx, refsAffected(r));
  const legs = await insertLegs(tx, userId, data, r);
  if (extra.loanId) await tx.transaction.update({ where: { id: legs[0].id }, data: { loanId: extra.loanId } });
  const affected = emptyAffected();
  legs.forEach((l) => collectAffected(affected, l));
  await recomputeAffected(tx, affected);
  if (data.applyToMerchant && r.merchantId && r.categoryId) await learnMerchantCategory(tx, userId, r.merchantId, r.categoryId, r.subCategoryId);
  await audit({ userId, action: AuditAction.TRANSACTION_CREATED, entityType: "Transaction", entityId: legs[0].id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind: data.kind, source: "MANUAL", legs: legs.length, loan: Boolean(extra.loanId) } }, tx);
  return legs[0];
}

async function findOwned(tx: Tx | typeof prisma, userId: string, id: string) {
  const t = await tx.transaction.findFirst({ where: { id, userId, deletedAt: null } });
  if (!t) throw new NotFoundError("Transaction not found.");
  const legs = t.transferGroupId
    ? await tx.transaction.findMany({ where: { userId, transferGroupId: t.transferGroupId, deletedAt: null }, orderBy: { direction: "desc" } })
    : [t];
  return { t, legs };
}

export async function updateTransaction(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(transactionSchema, input);
  return prisma.$transaction(async (tx) => {
    const { t, legs } = await findOwned(tx, userId, id);
    await assertNotLoanPayment(tx, t.id);
    const affected = emptyAffected();
    legs.forEach((l) => collectAffected(affected, l));
    const existingRefs = new Set<string>();
    for (const l of legs) {
      if (l.bankAccountId) existingRefs.add(`bank:${l.bankAccountId}`);
      if (l.creditCardId) existingRefs.add(`card:${l.creditCardId}`);
      if (l.cashAccountId) existingRefs.add(`cash:${l.cashAccountId}`);
    }
    const r = await resolve(tx, userId, data, existingRefs);
    const toLock = refsAffected(r);
    legs.forEach((l) => collectAffected(toLock, l));
    await lockForWrite(tx, toLock);
    const wasTransfer = Boolean(t.transferGroupId);
    const isTransfer = data.kind === "TRANSFER";
    let result;

    if (wasTransfer || isTransfer) {
      // Simplest correct approach for transfers: retire the old row(s), write fresh
      // ones, and move the old source records over so history is preserved.
      await tx.transaction.updateMany({ where: { id: { in: legs.map((l) => l.id) } }, data: { deletedAt: new Date() } });
      // Keep review/duplicate/import state — an edit must not make a pending or
      // duplicate row start counting.
      const carry: CarryOver = {
        status: t.status,
        sourceType: t.sourceType,
        duplicateStatus: t.duplicateStatus,
        duplicateOfId: t.duplicateOfId,
        importId: t.importId,
        confidenceScore: t.confidenceScore,
      };
      const created = await insertLegs(tx, userId, data, r, carry);
      // Move each old leg's source history to the new leg with the same direction.
      for (const old of legs) {
        const target = created.find((c) => c.direction === old.direction) ?? created[0];
        await tx.transactionSource.updateMany({ where: { transactionId: old.id }, data: { transactionId: target.id } });
      }
      for (const c of created) {
        if ((await tx.transactionSource.count({ where: { transactionId: c.id } })) === 0) {
          await tx.transactionSource.create({ data: { userId, transactionId: c.id, sourceType: "MANUAL", rawDescription: data.description, rawAmount: c.amount } });
        }
      }
      created.forEach((c) => collectAffected(affected, c));
      result = created[0];
    } else {
      const cols = accountColumns(r.from);
      if (data.kind === "CARD_PAYMENT" && r.to) cols.creditCardId = r.to.id;
      result = await tx.transaction.update({
        where: { id: t.id },
        data: { ...baseFields(data, r), ...cols, direction: r.spec.direction as TransactionDirection },
      });
      await writeDetailRows(tx, userId, t.id, data, r);
      collectAffected(affected, result);
    }

    await recomputeAffected(tx, affected);
    if (data.applyToMerchant && r.merchantId && r.categoryId) await learnMerchantCategory(tx, userId, r.merchantId, r.categoryId, r.subCategoryId);

    const changed = (["transactionDate", "amount", "description", "categoryId", "subCategoryId", "merchantName", "notes", "referenceNumber"] as const).filter((k) => {
      const before = t[k as keyof typeof t];
      const after = result[k as keyof typeof result];
      return String(before ?? "") !== String(after ?? "");
    });
    await audit({ userId, action: AuditAction.TRANSACTION_UPDATED, entityType: "Transaction", entityId: result.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { kind: data.kind, changed, learnedMerchant: Boolean(data.applyToMerchant && r.merchantId && r.categoryId) } }, tx);
    return result;
  });
}

/** Soft delete (both legs of a transfer). Balances are recomputed. */
export async function deleteTransaction(userId: string, id: string, meta: RequestMeta = NO_META) {
  await prisma.$transaction((tx) => deleteTransactionWithin(tx, userId, id, meta));
}

export async function deleteTransactionWithin(tx: Tx, userId: string, id: string, meta: RequestMeta = NO_META, opts: { fromLoan?: boolean } = {}) {
  const { t, legs } = await findOwned(tx, userId, id);
  if (!opts.fromLoan) await assertNotLoanPayment(tx, t.id);
  const affected = emptyAffected();
  legs.forEach((l) => collectAffected(affected, l));
  await lockForWrite(tx, affected);
  // A hidden duplicate of this row becomes the visible record instead of disappearing with it.
  for (const l of legs) {
    const promoted = await promoteDuplicatesOf(tx, l.id);
    promoted.bank.forEach((x) => affected.bank.add(x));
    promoted.card.forEach((x) => affected.card.add(x));
    promoted.cash.forEach((x) => affected.cash.add(x));
  }
  await tx.transaction.updateMany({ where: { id: { in: legs.map((l) => l.id) } }, data: { deletedAt: new Date() } });
  await recomputeAffected(tx, affected);
  await audit({ userId, action: AuditAction.TRANSACTION_DELETED, entityType: "Transaction", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { legs: legs.length } }, tx);
}

/** Loan repayments are managed from the loan page so the schedule stays in sync. */
async function assertNotLoanPayment(tx: Tx, transactionId: string) {
  // Only while the loan exists — after a loan is removed its ledger rows are ordinary transactions.
  const lp = await tx.loanPayment.findFirst({ where: { transactionId, deletedAt: null, loan: { deletedAt: null } }, select: { loanId: true } });
  if (lp) {
    throw new AppError("This is a recorded loan payment. Change or delete it from the loan's page so the EMI schedule stays correct.", 409, "LOAN_PAYMENT_LOCKED");
  }
}

// ───────────────────────────── queries ─────────────────────────────

const listInclude = {
  bankAccount: { select: { id: true, nickname: true, bankName: true, last4: true } },
  creditCard: { select: { id: true, bankName: true, cardName: true, last4: true } },
  cashAccount: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true, kind: true } },
  subCategory: { select: { id: true, name: true } },
  income: { select: { incomeCategory: true, sourceName: true, isRecurring: true } },
  expense: { select: { paymentMethod: true, isRecurring: true } },
  _count: { select: { sources: true } },
} satisfies Prisma.TransactionInclude;

export function buildTransactionWhere(userId: string, f: Partial<TransactionFilters>): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [{ userId, deletedAt: null }];
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { merchantName: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { referenceNumber: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.from || f.to) {
    and.push({ transactionDate: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T00:00:00Z`) } : {}) } });
  }
  const acct = parseAccountRef(f.account);
  if (acct) and.push(acct.kind === "bank" ? { bankAccountId: acct.id } : acct.kind === "cash" ? { cashAccountId: acct.id } : { creditCardId: acct.id });
  if (f.category === "none") and.push({ categoryId: null });
  else if (f.category) and.push({ categoryId: f.category });
  if (f.subCategory) and.push({ subCategoryId: f.subCategory });
  if (f.merchant) and.push({ merchantName: { contains: f.merchant, mode: "insensitive" } });
  if (f.min) and.push({ amount: { gte: toDecimal(f.min) } });
  if (f.max) and.push({ amount: { lte: toDecimal(f.max) } });
  if (f.type) and.push({ transactionType: f.type });
  if (f.direction) and.push({ direction: f.direction });
  if (f.source) and.push({ sourceType: f.source });
  if (f.duplicate) and.push({ duplicateStatus: f.duplicate });
  if (f.origin === "manual") and.push({ sourceType: "MANUAL" });
  if (f.origin === "imported") and.push({ sourceType: { not: "MANUAL" } });
  if (f.status) and.push({ status: f.status });
  return { AND: and };
}

export async function listTransactions(
  userId: string,
  f: Partial<TransactionFilters>,
  opts: { pageSize?: number; extraWhere?: Prisma.TransactionWhereInput } = {},
) {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const base = buildTransactionWhere(userId, f);
  const where: Prisma.TransactionWhereInput = opts.extraWhere ? { AND: [base, opts.extraWhere] } : base;
  const page = Math.max(1, Math.floor(Number(f.page) || 1));
  const [rows, total, sums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: listInclude,
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transaction.count({ where }),
    // Totals only include transactions that count (confirmed, not duplicates).
    prisma.transaction.groupBy({ by: ["direction"], where: { AND: [where, countableWhere(userId)] }, _sum: { amount: true } }),
  ]);
  const credit = sums.find((s) => s.direction === "CREDIT")?._sum.amount ?? toDecimal(0);
  const debit = sums.find((s) => s.direction === "DEBIT")?._sum.amount ?? toDecimal(0);
  return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), totals: { credit: roundMoney(credit), debit: roundMoney(debit) } };
}

export type TransactionRow = Awaited<ReturnType<typeof listTransactions>>["rows"][number];

export async function getTransaction(userId: string, id: string) {
  const t = await prisma.transaction.findFirst({ where: { id, userId, deletedAt: null }, include: { ...listInclude, sources: { orderBy: { createdAt: "asc" } } } });
  if (!t) throw new NotFoundError("Transaction not found.");
  const sibling = t.transferGroupId
    ? await prisma.transaction.findFirst({ where: { transferGroupId: t.transferGroupId, id: { not: t.id }, deletedAt: null } })
    : null;
  return { ...t, sibling };
}

/** Plain, client-safe representation (Decimals → strings) used to pre-fill the edit form. */
export function toFormValues(t: Awaited<ReturnType<typeof getTransaction>>) {
  const kind = kindOf(t.transactionType, t.direction);
  const isTransfer = Boolean(t.transferGroupId);
  const debitLeg = isTransfer ? (t.direction === "DEBIT" ? t : t.sibling) : t;
  const creditLeg = isTransfer ? (t.direction === "CREDIT" ? t : t.sibling) : null;
  const refOf = (x: { bankAccountId: string | null; cashAccountId: string | null; creditCardId: string | null } | null | undefined) =>
    x?.bankAccountId ? `bank:${x.bankAccountId}` : x?.cashAccountId ? `cash:${x.cashAccountId}` : x?.creditCardId ? `card:${x.creditCardId}` : "";
  return {
    id: t.id,
    kind: isTransfer ? ("TRANSFER" as const) : kind,
    transactionDate: t.transactionDate.toISOString().slice(0, 10),
    amount: t.amount.toFixed(2),
    account: kind === "CARD_PAYMENT" ? (t.bankAccountId ? `bank:${t.bankAccountId}` : `cash:${t.cashAccountId}`) : refOf(debitLeg),
    toAccount: creditLeg ? refOf(creditLeg) : "",
    creditCardId: kind === "CARD_PAYMENT" ? (t.creditCardId ?? "") : "",
    description: t.description,
    merchantName: t.merchantName ?? "",
    categoryId: t.categoryId ?? "",
    subCategoryId: t.subCategoryId ?? "",
    referenceNumber: t.referenceNumber ?? "",
    notes: t.notes ?? "",
    paymentMethod: t.expense?.paymentMethod ?? null,
    incomeCategory: t.income?.incomeCategory ?? null,
    sourceName: t.income?.sourceName ?? "",
    isRecurring: t.income?.isRecurring ?? t.expense?.isRecurring ?? false,
    applyToMerchant: false,
  };
}

export type TransactionFormValues = ReturnType<typeof toFormValues>;

/** Accounts, cards and categories for the transaction form. */
export async function getTransactionFormOptions(userId: string) {
  const [banks, cards, cash, categories] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" }, select: { id: true, nickname: true, bankName: true, last4: true } }),
    prisma.creditCard.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" }, select: { id: true, bankName: true, cardName: true, last4: true } }),
    prisma.cashAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    prisma.category.findMany({
      where: { deletedAt: null, OR: [{ userId: null }, { userId }] },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        kind: true,
        color: true,
        subCategories: { where: { deletedAt: null, OR: [{ userId: null }, { userId }] }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } },
      },
    }),
  ]);
  return {
    accounts: [
      ...banks.map((b) => ({ ref: `bank:${b.id}`, kind: "bank" as const, label: `${b.nickname} · ${b.bankName}${b.last4 ? ` ••${b.last4}` : ""}` })),
      ...cards.map((c) => ({ ref: `card:${c.id}`, kind: "card" as const, label: `${c.bankName} ${c.cardName} ••${c.last4}` })),
      ...cash.map((c) => ({ ref: `cash:${c.id}`, kind: "cash" as const, label: `${c.name} (cash)` })),
    ],
    cards: cards.map((c) => ({ id: c.id, label: `${c.bankName} ${c.cardName} ••${c.last4}` })),
    categories,
  };
}

export type TransactionFormOptions = Awaited<ReturnType<typeof getTransactionFormOptions>>;

export { kindOf };
