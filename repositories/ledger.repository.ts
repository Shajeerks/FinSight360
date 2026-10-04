import "server-only";
import { prisma } from "@/lib/db";
import { countableWhere } from "@/lib/transactions/countable";

export { countableWhere };

export const ledgerRepository = {
  /** Totals grouped by direction + type within [start, end). */
  totalsByType(userId: string, start: Date, end: Date) {
    return prisma.transaction.groupBy({
      by: ["direction", "transactionType"],
      where: countableWhere(userId, { transactionDate: { gte: start, lt: end } }),
      _sum: { amount: true },
    });
  },

  /** Spending by category within [start, end). */
  expenseByCategory(userId: string, start: Date, end: Date) {
    return prisma.transaction.groupBy({
      by: ["categoryId"],
      where: countableWhere(userId, {
        transactionDate: { gte: start, lt: end },
        direction: "DEBIT",
        transactionType: { in: ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"] },
      }),
      _sum: { amount: true },
    });
  },

  loanSplit(userId: string, start: Date, end: Date) {
    return prisma.loanPayment.aggregate({
      where: { loan: { userId, deletedAt: null }, deletedAt: null, paymentDate: { gte: start, lt: end } },
      _sum: { principalComponent: true, interestComponent: true },
    });
  },
};
