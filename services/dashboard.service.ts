import "server-only";
import { prisma } from "@/lib/db";
import { ledgerRepository } from "@/repositories/ledger.repository";
import { computeMonthlySummary, type LedgerEntry, type MonthlySummary } from "@/lib/finance/monthly-summary";
import { computeNetWorth, type NetWorth } from "@/lib/finance/net-worth";
import type { DueStatus } from "@/lib/finance/credit-card";
import { getCreditCardOverview } from "@/services/credit-card.service";
import { addDays, addMonths, daysBetween, monthLabel, monthRange, todayInTimezone, type YearMonth } from "@/lib/dates";
import { Decimal, percentOf, roundMoney, toDecimal } from "@/lib/money";

export async function monthSummary(userId: string, ym: YearMonth): Promise<MonthlySummary> {
  const { start, end } = monthRange(ym);
  const [groups, split] = await Promise.all([
    ledgerRepository.totalsByType(userId, start, end),
    ledgerRepository.loanSplit(userId, start, end),
  ]);
  const entries: LedgerEntry[] = groups.map((g) => ({
    amount: g._sum.amount ?? 0,
    direction: g.direction,
    transactionType: g.transactionType,
  }));
  return computeMonthlySummary(entries, [
    { principal: split._sum.principalComponent ?? 0, interest: split._sum.interestComponent ?? 0 },
  ]);
}

export type UpcomingPayment = {
  id: string;
  kind: "CARD" | "EMI" | "REMINDER";
  title: string;
  subtitle: string;
  amount: Decimal | null;
  dueDate: Date;
  daysRemaining: number;
  status: DueStatus;
};

export type Insight = { id: string; tone: "positive" | "warning" | "neutral"; text: string };

export async function getDashboardData(userId: string, ym: YearMonth, timezone = "Asia/Kolkata") {
  const today = todayInTimezone(timezone);
  const horizon = addDays(today, 30);

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const alertPct = toDecimal(profile?.cardUtilizationAlertPct ?? 30);

  const [banks, cash, holdings, loans, cardOverview, reminders, nextEmis, snapshots, current, previous] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, select: { currentBalance: true } }),
    prisma.cashAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, select: { currentBalance: true } }),
    prisma.investmentHolding.findMany({ where: { userId, deletedAt: null, investmentAccount: { deletedAt: null } }, select: { currentValue: true, investedAmount: true } }),
    prisma.loan.findMany({ where: { userId, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, lender: true, outstandingPrincipal: true, emiAmount: true } }),
    getCreditCardOverview(userId, timezone),
    prisma.reminder.findMany({
      where: { userId, deletedAt: null, status: "ACTIVE", dueDate: { lte: horizon }, creditCardId: null, loanId: null },
      orderBy: { dueDate: "asc" },
      take: 10,
    }),
    prisma.loanAmortizationSchedule.findMany({
      where: { loan: { userId, deletedAt: null, status: "ACTIVE" }, status: { in: ["UPCOMING", "PARTIALLY_PAID", "MISSED"] }, dueDate: { lte: horizon } },
      orderBy: { dueDate: "asc" },
      include: { loan: { select: { name: true, lender: true } } },
      take: 10,
    }),
    prisma.netWorthSnapshot.findMany({ where: { userId, snapshotDate: { gte: new Date(Date.UTC(ym.year, ym.month - 13, 1)) } }, orderBy: { snapshotDate: "asc" } }),
    monthSummary(userId, ym),
    monthSummary(userId, addMonths(ym, -1)),
  ]);

  // ── Net worth ──
  const netWorth: NetWorth = computeNetWorth({
    bankBalances: banks.map((b) => b.currentBalance),
    cashBalances: cash.map((c) => c.currentBalance),
    investmentValues: holdings.map((h) => h.currentValue ?? h.investedAmount),
    loanOutstanding: loans.map((l) => l.outstandingPrincipal),
    creditCardOutstanding: cardOverview.cards.filter((c) => c.status !== "CLOSED").map((c) => c.currentOutstanding),
  });
  const investedTotal = roundMoney(holdings.reduce((a, h) => a.plus(h.investedAmount), new Decimal(0)));

  // ── Credit cards (same calculation as the Credit Cards page) ──
  const cardRows = cardOverview.cards.filter((c) => c.status !== "CLOSED");
  const cardTotals = cardOverview.totals;

  // ── Upcoming payments (next 30 days + anything overdue) ──
  const upcoming: UpcomingPayment[] = [];
  for (const c of cardRows) {
    if (c.due.status === "NO_DUE" || !c.due.dueDate || c.due.dueDate > horizon) continue;
    upcoming.push({
      id: `card-${c.id}`,
      kind: "CARD",
      title: `${c.bankName} ${c.cardName}`,
      subtitle: `Card •••• ${c.last4}`,
      amount: c.due.amountDue,
      dueDate: c.due.dueDate,
      daysRemaining: c.due.daysRemaining ?? 0,
      status: c.due.status,
    });
  }
  const seenLoans = new Set<string>();
  for (const s of nextEmis) {
    if (seenLoans.has(s.loanId)) continue;
    seenLoans.add(s.loanId);
    const d = daysBetween(today, s.dueDate);
    upcoming.push({
      id: `emi-${s.id}`,
      kind: "EMI",
      title: `${s.loan.name} EMI #${s.installmentNumber}`,
      subtitle: s.loan.lender,
      amount: s.emiAmount,
      dueDate: s.dueDate,
      daysRemaining: d,
      status: d < 0 ? "OVERDUE" : d === 0 ? "DUE_TODAY" : d <= 5 ? "DUE_SOON" : "UPCOMING",
    });
  }
  for (const r of reminders) {
    const d = daysBetween(today, r.dueDate);
    upcoming.push({
      id: `rem-${r.id}`,
      kind: "REMINDER",
      title: r.title,
      subtitle: r.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase()),
      amount: r.amount,
      dueDate: r.dueDate,
      daysRemaining: d,
      status: d < 0 ? "OVERDUE" : d === 0 ? "DUE_TODAY" : d <= r.leadDays ? "DUE_SOON" : "UPCOMING",
    });
  }
  upcoming.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  // ── Expense breakdown (selected month) ──
  const { start, end } = monthRange(ym);
  const byCategory = await ledgerRepository.expenseByCategory(userId, start, end);
  const categoryIds = byCategory.map((g) => g.categoryId).filter((v): v is string => Boolean(v));
  const categories = categoryIds.length
    ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true, color: true } })
    : [];
  const expenseBreakdown = byCategory
    .map((g) => {
      const cat = categories.find((c) => c.id === g.categoryId);
      return { name: cat?.name ?? "Uncategorized", color: cat?.color ?? "#a1a1aa", amount: roundMoney(g._sum.amount ?? 0) };
    })
    .sort((a, b) => b.amount.comparedTo(a.amount));

  // ── Income vs expense (last 6 months ending at selected month) ──
  const months = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
  const trend = await Promise.all(months.map(async (m) => ({ ym: m, label: monthLabel(m, "short"), summary: await monthSummary(userId, m) })));

  // ── Net worth trend ──
  // Snapshots are daily; the trend uses the last one of each month (12 months).
  const byMonth = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) byMonth.set(s.snapshotDate.toISOString().slice(0, 7), s);
  const netWorthTrend = [...byMonth.values()].slice(-12).map((s) => ({ date: s.snapshotDate, netWorth: roundMoney(s.netWorth) }));

  // ── Early, rule-based insights (full spending intelligence arrives in Phase 7) ──
  const insights: Insight[] = [];
  if (cardRows.length && cardTotals.utilizationPct.greaterThan(alertPct)) {
    insights.push({ id: "util", tone: "warning", text: `Overall credit-card utilization is ${cardTotals.utilizationPct.toFixed(1)}%, above your ${alertPct.toFixed(0)}% alert threshold.` });
  }
  const overdue = upcoming.filter((u) => u.status === "OVERDUE").length;
  if (overdue) insights.push({ id: "overdue", tone: "warning", text: `${overdue} payment${overdue > 1 ? "s are" : " is"} overdue.` });
  if (!current.income.isZero() && !previous.expenses.isZero()) {
    const change = percentOf(current.expenses.minus(previous.expenses), previous.expenses, 1);
    if (change.abs().greaterThanOrEqualTo(5)) {
      insights.push({
        id: "exp-change",
        tone: change.isPositive() ? "warning" : "positive",
        text: `Spending is ${change.abs().toFixed(1)}% ${change.isPositive() ? "higher" : "lower"} than ${monthLabel(addMonths(ym, -1), "long")}.`,
      });
    }
  }
  if (!current.income.isZero()) {
    insights.push({
      id: "savings",
      tone: current.savingsRatePct.greaterThanOrEqualTo(20) ? "positive" : "neutral",
      text: `You kept ${current.savingsRatePct.toFixed(1)}% of this month's income after expenses and EMIs.`,
    });
  }

  const hasAnyData = banks.length + cardRows.length + loans.length + holdings.length > 0;

  return {
    today,
    month: ym,
    hasAnyData,
    netWorth,
    investedTotal,
    loansOutstanding: netWorth.loans,
    monthlyEmiCommitment: roundMoney(loans.reduce((a, l) => a.plus(l.emiAmount), new Decimal(0))),
    current,
    previous,
    cards: cardRows,
    cardTotals,
    upcoming: upcoming.slice(0, 8),
    expenseBreakdown,
    trend,
    netWorthTrend,
    insights,
  };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null, channel: "IN_APP" } });
}
