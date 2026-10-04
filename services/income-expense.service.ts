import "server-only";
import { prisma } from "@/lib/db";
import { countableWhere } from "@/lib/transactions/countable";
import { addMonths, monthRange, type YearMonth } from "@/lib/dates";
import { Decimal, percentOf, roundMoney, toDecimal } from "@/lib/money";
import { computeMonthlySummary } from "@/lib/finance/monthly-summary";
import { listTransactions } from "@/services/transaction.service";

const EXPENSE_TYPES = ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"] as const;

async function monthTotals(userId: string, ym: YearMonth) {
  const { start, end } = monthRange(ym);
  const groups = await prisma.transaction.groupBy({
    by: ["direction", "transactionType"],
    where: countableWhere(userId, { transactionDate: { gte: start, lt: end } }),
    _sum: { amount: true },
  });
  return computeMonthlySummary(groups.map((g) => ({ amount: g._sum.amount ?? 0, direction: g.direction, transactionType: g.transactionType })));
}

export async function getIncomeOverview(userId: string, ym: YearMonth, page = 1) {
  const { start, end } = monthRange(ym);
  const where = countableWhere(userId, { transactionDate: { gte: start, lt: end }, direction: "CREDIT", transactionType: { in: ["INCOME", "INTEREST"] } });
  const [current, previous, details, list] = await Promise.all([
    monthTotals(userId, ym),
    monthTotals(userId, addMonths(ym, -1)),
    prisma.transaction.findMany({ where, select: { amount: true, income: { select: { incomeCategory: true, sourceName: true } } } }),
    listTransactions(userId, { ...monthFilter(ym), page }, { extraWhere: { direction: "CREDIT", transactionType: { in: ["INCOME", "INTEREST"] } } }),
  ]);

  const byCategory = new Map<string, Decimal>();
  const bySource = new Map<string, Decimal>();
  for (const d of details) {
    const cat = d.income?.incomeCategory ?? "OTHER";
    byCategory.set(cat, (byCategory.get(cat) ?? new Decimal(0)).plus(d.amount));
    const src = d.income?.sourceName || "Unspecified";
    bySource.set(src, (bySource.get(src) ?? new Decimal(0)).plus(d.amount));
  }
  const total = current.income;
  return {
    total,
    previousTotal: previous.income,
    change: previous.income.isZero() ? null : percentOf(total.minus(previous.income), previous.income, 1),
    byCategory: [...byCategory.entries()].map(([k, v]) => ({ key: k, amount: roundMoney(v), share: percentOf(v, total, 1) })).sort((a, b) => b.amount.comparedTo(a.amount)),
    bySource: [...bySource.entries()].map(([k, v]) => ({ key: k, amount: roundMoney(v) })).sort((a, b) => b.amount.comparedTo(a.amount)).slice(0, 6),
    list,
  };
}

export function monthFilter(ym: YearMonth) {
  const { start, end } = monthRange(ym);
  return { from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) };
}

/** Expense-side rows: spending debits plus refunds/reversals. */
export const EXPENSE_LIST_WHERE = {
  OR: [
    { direction: "DEBIT" as const, transactionType: { in: [...EXPENSE_TYPES] } },
    { direction: "CREDIT" as const, transactionType: { in: ["REFUND" as const, "REVERSAL" as const] } },
  ],
};

export async function getExpenseOverview(userId: string, ym: YearMonth, page = 1) {
  const { start, end } = monthRange(ym);
  const baseWhere = { transactionDate: { gte: start, lt: end } };
  const [current, previous, debits, refunds, methods, list] = await Promise.all([
    monthTotals(userId, ym),
    monthTotals(userId, addMonths(ym, -1)),
    prisma.transaction.groupBy({
      by: ["categoryId", "subCategoryId"],
      where: countableWhere(userId, { ...baseWhere, direction: "DEBIT", transactionType: { in: [...EXPENSE_TYPES] } }),
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.transaction.groupBy({
      by: ["categoryId", "subCategoryId"],
      where: countableWhere(userId, { ...baseWhere, direction: "CREDIT", transactionType: { in: ["REFUND", "REVERSAL"] } }),
      _sum: { amount: true },
    }),
    prisma.expense.findMany({
      where: { userId, transaction: countableWhere(userId, baseWhere) },
      select: { paymentMethod: true, transaction: { select: { amount: true } } },
    }),
    listTransactions(userId, { ...monthFilter(ym), page }, { extraWhere: EXPENSE_LIST_WHERE }),
  ]);

  const catIds = [...new Set([...debits, ...refunds].map((d) => d.categoryId).filter((v): v is string => Boolean(v)))];
  const subIds = [...new Set([...debits, ...refunds].map((d) => d.subCategoryId).filter((v): v is string => Boolean(v)))];
  const [cats, subs] = await Promise.all([
    prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true, color: true, isFixed: true } }),
    prisma.subCategory.findMany({ where: { id: { in: subIds } }, select: { id: true, name: true } }),
  ]);

  type Node = { id: string | null; name: string; color: string; isFixed: boolean; amount: Decimal; count: number; subs: Map<string, { name: string; amount: Decimal }> };
  const tree = new Map<string, Node>();
  const add = (categoryId: string | null, subCategoryId: string | null, amount: Decimal, count: number) => {
    const key = categoryId ?? "none";
    const cat = cats.find((c) => c.id === categoryId);
    const node = tree.get(key) ?? { id: categoryId, name: cat?.name ?? "Uncategorized", color: cat?.color ?? "#a1a1aa", isFixed: cat?.isFixed ?? false, amount: new Decimal(0), count: 0, subs: new Map() };
    node.amount = node.amount.plus(amount);
    node.count += count;
    const subName = subs.find((s) => s.id === subCategoryId)?.name ?? "General";
    const sub = node.subs.get(subName) ?? { name: subName, amount: new Decimal(0) };
    sub.amount = sub.amount.plus(amount);
    node.subs.set(subName, sub);
    tree.set(key, node);
  };
  debits.forEach((d) => add(d.categoryId, d.subCategoryId, toDecimal(d._sum.amount), d._count._all));
  refunds.forEach((d) => add(d.categoryId, d.subCategoryId, toDecimal(d._sum.amount).negated(), 0));

  const total = current.expenses;
  const categories = [...tree.values()]
    .map((n) => ({
      ...n,
      amount: roundMoney(n.amount),
      share: percentOf(n.amount, total, 1),
      subs: [...n.subs.values()].map((s) => ({ ...s, amount: roundMoney(s.amount) })).sort((a, b) => b.amount.comparedTo(a.amount)),
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

  const fixed = categories.filter((c) => c.isFixed).reduce((a, c) => a.plus(c.amount), new Decimal(0));
  const methodTotals = new Map<string, Decimal>();
  for (const m of methods) methodTotals.set(m.paymentMethod, (methodTotals.get(m.paymentMethod) ?? new Decimal(0)).plus(m.transaction.amount));

  return {
    total,
    previousTotal: previous.expenses,
    change: previous.expenses.isZero() ? null : percentOf(total.minus(previous.expenses), previous.expenses, 1),
    fixed: roundMoney(fixed),
    discretionary: roundMoney(total.minus(fixed)),
    categories,
    paymentMethods: [...methodTotals.entries()].map(([k, v]) => ({ key: k, amount: roundMoney(v) })).sort((a, b) => b.amount.comparedTo(a.amount)),
    list,
  };
}
