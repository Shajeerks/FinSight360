import "server-only";
import { prisma } from "@/lib/db";
import { countableWhere } from "@/lib/transactions/countable";
import { ledgerRepository } from "@/repositories/ledger.repository";
import { addMonths, monthRange, type YearMonth } from "@/lib/dates";
import { Decimal, roundMoney, toDecimal } from "@/lib/money";
import { merchantKey } from "@/lib/transactions/normalize";
import { categoryTrends, findUnusual, ratios, ratioTips, type CategoryAmount } from "@/lib/analytics/insights";
import { monthSummary } from "@/services/dashboard.service";
import { budgetProgress } from "@/services/budget.service";
import { listRecurring } from "@/services/recurring.service";
import { currentNetWorth, netWorthHistory } from "@/services/networth.service";

const SPEND_TYPES = ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"] as const;

async function categoryAmounts(userId: string, ym: YearMonth, names: Map<string, string>): Promise<CategoryAmount[]> {
  const { start, end } = monthRange(ym);
  const groups = await ledgerRepository.expenseByCategory(userId, start, end);
  return groups.map((g) => ({ id: g.categoryId ?? "_none", name: g.categoryId ? (names.get(g.categoryId) ?? "Other") : "Uncategorized", amount: g._sum.amount ?? 0 }));
}

/** Everything the Monthly Analysis page shows, for one month. */
export async function getAnalytics(userId: string, ym: YearMonth) {
  const { start, end } = monthRange(ym);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(ym, i - 11));
  const cats = await prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] }, select: { id: true, name: true, color: true } });
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const colors = new Map(cats.map((c) => [c.id, c.color]));

  const [series, current, previous, prev2, prev3] = await Promise.all([
    Promise.all(months.map((m) => monthSummary(userId, m))),
    categoryAmounts(userId, ym, names),
    categoryAmounts(userId, addMonths(ym, -1), names),
    categoryAmounts(userId, addMonths(ym, -2), names),
    categoryAmounts(userId, addMonths(ym, -3), names),
  ]);
  const summary = series[series.length - 1];
  const prevSummary = series[series.length - 2];

  // Spending detail for this month + 6 months of history (unusual payments, merchants, weekdays).
  const histStart = monthRange(addMonths(ym, -6)).start;
  const spendRows = await prisma.transaction.findMany({
    where: countableWhere(userId, { transactionDate: { gte: histStart, lt: end }, direction: "DEBIT", transactionType: { in: [...SPEND_TYPES] } }),
    select: { id: true, transactionDate: true, amount: true, description: true, merchantName: true, categoryId: true },
    orderBy: { transactionDate: "asc" },
  });
  const toU = (t: (typeof spendRows)[number]) => ({ id: t.id, transactionDate: t.transactionDate, amount: t.amount, description: t.description, merchantKey: merchantKey(t.merchantName) || null, categoryId: t.categoryId });
  const thisMonth = spendRows.filter((t) => t.transactionDate >= start);
  const history = spendRows.filter((t) => t.transactionDate < start);
  const unusual = findUnusual(thisMonth.map(toU), history.map(toU)).slice(0, 10).map((u) => ({ ...u, category: u.categoryId ? (names.get(u.categoryId) ?? null) : null, merchant: thisMonth.find((t) => t.id === u.id)?.merchantName ?? null }));

  const merchants = new Map<string, { name: string; amount: Decimal; count: number }>();
  for (const t of thisMonth) {
    const k = merchantKey(t.merchantName) || "(no merchant)";
    const m = merchants.get(k) ?? { name: t.merchantName ?? "(no merchant)", amount: new Decimal(0), count: 0 };
    merchants.set(k, { ...m, amount: m.amount.plus(t.amount), count: m.count + 1 });
  }
  const weekday = Array.from({ length: 7 }, () => new Decimal(0));
  for (const t of thisMonth) weekday[t.transactionDate.getUTCDay()] = weekday[t.transactionDate.getUTCDay()].plus(t.amount);

  const r = ratios(summary);
  const [recurring, budgets, nw, nwHistory] = await Promise.all([listRecurring(userId), budgetProgress(userId, ym), currentNetWorth(userId), netWorthHistory(userId)]);

  const change = (a: Decimal, b: Decimal) => (b.isZero() ? null : Math.round(a.minus(b).dividedBy(b.abs()).times(1000).toNumber()) / 10);
  return {
    month: ym,
    summary,
    comparison: {
      income: change(summary.income, prevSummary.income),
      expenses: change(summary.expenses, prevSummary.expenses),
      savings: change(summary.savings, prevSummary.savings),
      emi: change(summary.emi, prevSummary.emi),
      investments: change(summary.investments, prevSummary.investments),
    },
    series: series.map((s, i) => ({ ym: months[i], income: s.income.toNumber(), expenses: s.expenses.toNumber(), emi: s.emi.toNumber(), investments: s.investments.toNumber(), savings: s.savings.toNumber() })),
    categories: categoryTrends(current, previous, [previous, prev2, prev3]).map((c) => ({ ...c, color: colors.get(c.id) ?? null })),
    ratios: r,
    tips: ratioTips(r),
    unusual,
    topMerchants: [...merchants.values()].sort((a, b) => b.amount.comparedTo(a.amount)).slice(0, 8).map((m) => ({ ...m, amount: roundMoney(m.amount) })),
    weekday: weekday.map((v, i) => ({ day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i], amount: roundMoney(v).toNumber() })),
    recurring,
    budgets,
    netWorth: nw,
    netWorthHistory: nwHistory,
    spendCount: thisMonth.length,
    averageSpend: thisMonth.length ? roundMoney(thisMonth.reduce((a, t) => a.plus(toDecimal(t.amount)), new Decimal(0)).dividedBy(thisMonth.length)) : null,
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
