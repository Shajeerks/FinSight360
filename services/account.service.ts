import "server-only";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { openingForTarget } from "@/lib/finance/balances";
import { roundMoney, sum } from "@/lib/money";
import { bankAccountSchema, cashAccountSchema } from "@/validators/accounts";
import { ledgerNet, recomputeBankBalance, recomputeCashBalance } from "@/services/ledger-balance.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };

// ───────────────────────────── bank accounts ─────────────────────────────

export async function listBankAccounts(userId: string) {
  const accounts = await prisma.bankAccount.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { transactions: { where: { deletedAt: null } } } } },
  });
  return accounts.map(({ _count, ...a }) => ({ ...a, transactionCount: _count.transactions }));
}

export async function getBankAccount(userId: string, id: string) {
  const a = await prisma.bankAccount.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw new NotFoundError("Bank account not found.");
  return a;
}

export async function createBankAccount(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(bankAccountSchema, input);
  return prisma.$transaction(async (tx) => {
    const acct = await tx.bankAccount.create({
      data: {
        userId,
        bankName: data.bankName,
        nickname: data.nickname,
        accountType: data.accountType,
        last4: data.last4,
        // New account: no ledger entries yet, so opening = current.
        openingBalance: roundMoney(data.currentBalance),
        currentBalance: roundMoney(data.currentBalance),
        currency: data.currency,
        status: data.status,
        notes: data.notes,
      },
    });
    await audit({ userId, action: AuditAction.ACCOUNT_CREATED, entityType: "BankAccount", entityId: acct.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return acct;
  });
}

/**
 * Update details. The user enters the balance the bank shows today; we derive the
 * opening balance so that opening + recorded transactions = that balance.
 */
export async function updateBankAccount(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(bankAccountSchema, input);
  await getBankAccount(userId, id);
  return prisma.$transaction(async (tx) => {
    const net = await ledgerNet(tx, { kind: "bank", id, userId });
    await tx.bankAccount.update({
      where: { id },
      data: {
        bankName: data.bankName,
        nickname: data.nickname,
        accountType: data.accountType,
        last4: data.last4,
        openingBalance: openingForTarget(data.currentBalance, net),
        currency: data.currency,
        status: data.status,
        notes: data.notes,
      },
    });
    await recomputeBankBalance(tx, id);
    await audit({ userId, action: AuditAction.ACCOUNT_UPDATED, entityType: "BankAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return tx.bankAccount.findUniqueOrThrow({ where: { id } });
  });
}

/** Soft delete. Its transactions are kept (history is never destroyed). */
export async function deleteBankAccount(userId: string, id: string, meta: RequestMeta = NO_META) {
  await getBankAccount(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.bankAccount.update({ where: { id }, data: { deletedAt: new Date(), status: "CLOSED" } });
    await audit({ userId, action: AuditAction.ACCOUNT_DELETED, entityType: "BankAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

// ───────────────────────────── cash wallets ─────────────────────────────

export async function listCashAccounts(userId: string) {
  return prisma.cashAccount.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } });
}

export async function getCashAccount(userId: string, id: string) {
  const a = await prisma.cashAccount.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw new NotFoundError("Cash wallet not found.");
  return a;
}

export async function createCashAccount(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(cashAccountSchema, input);
  return prisma.$transaction(async (tx) => {
    const acct = await tx.cashAccount.create({
      data: { userId, name: data.name, openingBalance: roundMoney(data.currentBalance), currentBalance: roundMoney(data.currentBalance), status: data.status, notes: data.notes },
    });
    await audit({ userId, action: AuditAction.ACCOUNT_CREATED, entityType: "CashAccount", entityId: acct.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return acct;
  });
}

export async function updateCashAccount(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(cashAccountSchema, input);
  await getCashAccount(userId, id);
  return prisma.$transaction(async (tx) => {
    const net = await ledgerNet(tx, { kind: "cash", id, userId });
    await tx.cashAccount.update({
      where: { id },
      data: { name: data.name, openingBalance: openingForTarget(data.currentBalance, net), status: data.status, notes: data.notes },
    });
    await recomputeCashBalance(tx, id);
    await audit({ userId, action: AuditAction.ACCOUNT_UPDATED, entityType: "CashAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return tx.cashAccount.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteCashAccount(userId: string, id: string, meta: RequestMeta = NO_META) {
  await getCashAccount(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.cashAccount.update({ where: { id }, data: { deletedAt: new Date(), status: "CLOSED" } });
    await audit({ userId, action: AuditAction.ACCOUNT_DELETED, entityType: "CashAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

export async function accountsSummary(userId: string) {
  const [banks, cash] = await Promise.all([listBankAccounts(userId), listCashAccounts(userId)]);
  const active = banks.filter((b) => b.status !== "CLOSED");
  return {
    banks,
    cash,
    totalBank: roundMoney(sum(active.map((b) => b.currentBalance))),
    totalCash: roundMoney(sum(cash.filter((c) => c.status !== "CLOSED").map((c) => c.currentBalance))),
  };
}

/** Throws unless the account/card belongs to the user and is usable. */
export async function assertAccountRef(
  db: Pick<typeof prisma, "bankAccount" | "cashAccount" | "creditCard">,
  userId: string,
  ref: { kind: "bank" | "card" | "cash"; id: string },
  opts: { allowRemoved?: boolean } = {},
) {
  // allowRemoved: editing a transaction that already belongs to a removed account.
  const where = { id: ref.id, userId, ...(opts.allowRemoved ? {} : { deletedAt: null }) };
  const found =
    ref.kind === "bank"
      ? await db.bankAccount.findFirst({ where, select: { id: true } })
      : ref.kind === "cash"
        ? await db.cashAccount.findFirst({ where, select: { id: true } })
        : await db.creditCard.findFirst({ where, select: { id: true } });
  if (!found) throw new AppError("That account doesn't exist or isn't yours.", 400, "INVALID_ACCOUNT", { account: ["Choose one of your accounts"] });
}
