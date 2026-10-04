/**
 * Keeps stored balances in sync with the ledger. Balances are always
 * RE-COMPUTED from scratch (opening value + every countable transaction), never
 * incremented, so they can't drift. Safe to call inside a DB transaction.
 *
 * (No "server-only" import so the seed script can reuse it.)
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { accountBalance, cardOutstanding } from "@/lib/finance/balances";
import { countableWhere } from "@/lib/transactions/countable";

type Db = PrismaClient | Prisma.TransactionClient;

export type AffectedAccounts = { bank: Set<string>; card: Set<string>; cash: Set<string> };

export function emptyAffected(): AffectedAccounts {
  return { bank: new Set(), card: new Set(), cash: new Set() };
}

export function collectAffected(
  into: AffectedAccounts,
  t: { bankAccountId?: string | null; creditCardId?: string | null; cashAccountId?: string | null } | null | undefined,
) {
  if (!t) return into;
  if (t.bankAccountId) into.bank.add(t.bankAccountId);
  if (t.creditCardId) into.card.add(t.creditCardId);
  if (t.cashAccountId) into.cash.add(t.cashAccountId);
  return into;
}

/**
 * Row-lock the account/card for the rest of the DB transaction so concurrent
 * writers recompute one after another (each then sees the other's committed rows).
 */
export async function lockAccount(db: Db, kind: "bank" | "card" | "cash", id: string) {
  if (kind === "bank") await db.$queryRaw`SELECT id FROM "bank_accounts" WHERE id = ${id} FOR UPDATE`;
  else if (kind === "card") await db.$queryRaw`SELECT id FROM "credit_cards" WHERE id = ${id} FOR UPDATE`;
  else await db.$queryRaw`SELECT id FROM "cash_accounts" WHERE id = ${id} FOR UPDATE`;
}

/**
 * Lock every account/card a write will touch, in a fixed order, BEFORE inserting
 * or updating ledger rows. (Inserting a transaction takes a FK key-share lock on
 * its account; locking first prevents writer deadlocks.)
 */
export async function lockForWrite(db: Db, affected: AffectedAccounts) {
  for (const id of [...affected.bank].sort()) await lockAccount(db, "bank", id);
  for (const id of [...affected.card].sort()) await lockAccount(db, "card", id);
  for (const id of [...affected.cash].sort()) await lockAccount(db, "cash", id);
}

export async function recomputeBankBalance(db: Db, bankAccountId: string) {
  await lockAccount(db, "bank", bankAccountId);
  const acct = await db.bankAccount.findUnique({ where: { id: bankAccountId }, select: { userId: true, openingBalance: true } });
  if (!acct) return null;
  const groups = await db.transaction.groupBy({
    by: ["direction"],
    where: countableWhere(acct.userId, { bankAccountId }),
    _sum: { amount: true },
  });
  const balance = accountBalance(acct.openingBalance, groups.map((g) => ({ amount: g._sum.amount ?? 0, direction: g.direction })));
  await db.bankAccount.update({ where: { id: bankAccountId }, data: { currentBalance: balance } });
  return balance;
}

export async function recomputeCashBalance(db: Db, cashAccountId: string) {
  await lockAccount(db, "cash", cashAccountId);
  const acct = await db.cashAccount.findUnique({ where: { id: cashAccountId }, select: { userId: true, openingBalance: true } });
  if (!acct) return null;
  const groups = await db.transaction.groupBy({
    by: ["direction"],
    where: countableWhere(acct.userId, { cashAccountId }),
    _sum: { amount: true },
  });
  const balance = accountBalance(acct.openingBalance, groups.map((g) => ({ amount: g._sum.amount ?? 0, direction: g.direction })));
  await db.cashAccount.update({ where: { id: cashAccountId }, data: { currentBalance: balance } });
  return balance;
}

export async function recomputeCardOutstanding(db: Db, creditCardId: string) {
  await lockAccount(db, "card", creditCardId);
  const card = await db.creditCard.findUnique({ where: { id: creditCardId }, select: { userId: true, openingOutstanding: true } });
  if (!card) return null;
  const groups = await db.transaction.groupBy({
    by: ["direction", "transactionType"],
    where: countableWhere(card.userId, { creditCardId }),
    _sum: { amount: true },
  });
  const outstanding = cardOutstanding(
    card.openingOutstanding,
    groups.map((g) => ({ amount: g._sum.amount ?? 0, direction: g.direction, transactionType: g.transactionType })),
  );
  await db.creditCard.update({ where: { id: creditCardId }, data: { currentOutstanding: outstanding } });
  return outstanding;
}

/** Net effect of the ledger alone (opening = 0) — used to reconcile to a real balance. */
export async function ledgerNet(db: Db, ref: { kind: "bank" | "card" | "cash"; id: string; userId: string }) {
  await lockAccount(db, ref.kind, ref.id);
  const where =
    ref.kind === "bank" ? { bankAccountId: ref.id } : ref.kind === "cash" ? { cashAccountId: ref.id } : { creditCardId: ref.id };
  const groups = await db.transaction.groupBy({
    by: ["direction", "transactionType"],
    where: countableWhere(ref.userId, where),
    _sum: { amount: true },
  });
  const entries = groups.map((g) => ({ amount: g._sum.amount ?? 0, direction: g.direction, transactionType: g.transactionType }));
  return ref.kind === "card" ? cardOutstanding(0, entries) : accountBalance(0, entries);
}

export async function recomputeAffected(db: Db, affected: AffectedAccounts) {
  // Sorted order keeps lock acquisition consistent across writers (no deadlocks).
  affected = { bank: new Set([...affected.bank].sort()), card: new Set([...affected.card].sort()), cash: new Set([...affected.cash].sort()) };
  for (const id of affected.bank) await recomputeBankBalance(db, id);
  for (const id of affected.card) await recomputeCardOutstanding(db, id);
  for (const id of affected.cash) await recomputeCashBalance(db, id);
}
