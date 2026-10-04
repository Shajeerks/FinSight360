import type { Prisma } from "@prisma/client";

/**
 * The single definition of "a transaction that counts toward totals and balances":
 * confirmed, not deleted, and not a duplicate of another transaction.
 */
export function countableWhere(userId: string, extra: Prisma.TransactionWhereInput = {}): Prisma.TransactionWhereInput {
  return { userId, deletedAt: null, status: "CONFIRMED", duplicateOfId: null, ...extra };
}
