import type { Metadata } from "next";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  HandCoins,
  Landmark,
  PiggyBank,
  Scale,
  TrendingUp,
} from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getDashboardData } from "@/services/dashboard.service";
import { currentYearMonth, monthLabel, parseYearMonth, DEFAULT_TIMEZONE, formatDate } from "@/lib/dates";
import { formatMoney, percentOf } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, type Trend } from "@/features/dashboard/components/stat-card";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { IncomeExpenseChart } from "@/features/dashboard/components/income-expense-chart";
import { ExpenseBreakdownChart } from "@/features/dashboard/components/expense-breakdown-chart";
import { NetWorthChart } from "@/features/dashboard/components/net-worth-chart";
import { UpcomingPayments } from "@/features/dashboard/components/upcoming-payments";
import { CreditCardSummary } from "@/features/dashboard/components/credit-card-summary";
import { InsightsPanel } from "@/features/dashboard/components/insights-panel";
import { GettingStarted } from "@/features/dashboard/components/getting-started";
import type { Decimal } from "@/lib/money";

export const metadata: Metadata = { title: "Dashboard" };

const money0 = (v: Decimal) => formatMoney(v, { decimals: 0 });

function trend(curr: Decimal, prev: Decimal, goodWhen: "up" | "down"): Trend {
  if (prev.isZero()) return null;
  return { pct: percentOf(curr.minus(prev), prev.abs(), 1).toNumber(), goodWhen, label: "vs last month" };
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  const profile = await prisma.userProfile.findUnique({ where: { userId: user.id }, select: { timezone: true } });
  const tz = profile?.timezone ?? DEFAULT_TIMEZONE;
  const sp = await searchParams;
  const nowYm = currentYearMonth(tz);
  const requested = parseYearMonth(typeof sp.month === "string" ? sp.month : null);
  const ym = requested && requested.year * 12 + requested.month <= nowYm.year * 12 + nowYm.month ? requested : nowYm;

  const d = await getDashboardData(user.id, ym, tz);
  const c = d.current;
  const invGain = d.netWorth.investments.minus(d.investedTotal);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Your finances for ${monthLabel(ym)} · as of ${formatDate(d.today)}`}
        actions={<MonthSwitcher month={ym} current={nowYm} />}
      />

      {!d.hasAnyData && <GettingStarted name={user.name} />}

      {/* Position */}
      <section aria-label="Financial position" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard title="Net Worth" value={money0(d.netWorth.netWorth)} icon={Scale} tone="primary" sub="Assets − liabilities" className="col-span-2 xl:col-span-1" />
        <StatCard title="Total Assets" value={money0(d.netWorth.totalAssets)} icon={Landmark} sub={`Bank ${formatMoney(d.netWorth.bank, { compact: true })} · Inv ${formatMoney(d.netWorth.investments, { compact: true })}`} />
        <StatCard title="Total Liabilities" value={money0(d.netWorth.totalLiabilities)} icon={HandCoins} tone="danger" sub={`Loans ${formatMoney(d.netWorth.loans, { compact: true })} · Cards ${formatMoney(d.netWorth.creditCards, { compact: true })}`} />
        <StatCard
          title="Investments"
          value={money0(d.netWorth.investments)}
          icon={TrendingUp}
          sub={
            d.investedTotal.isZero()
              ? "No holdings yet"
              : `${invGain.isNegative() ? "" : "+"}${money0(invGain)} (${percentOf(invGain, d.investedTotal, 1).toFixed(1)}%)`
          }
          className="col-span-2 sm:col-span-1"
        />
      </section>

      {/* This month */}
      <section aria-label="This month" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard title="Income" value={money0(c.income)} icon={ArrowDownCircle} trend={trend(c.income, d.previous.income, "up")} />
        <StatCard title="Expenses" value={money0(c.expenses)} icon={ArrowUpCircle} trend={trend(c.expenses, d.previous.expenses, "down")} />
        <StatCard title="EMI Paid" value={money0(c.emi)} icon={Banknote} sub={c.interestPaid.isZero() ? `Monthly commitment ${money0(d.monthlyEmiCommitment)}` : `Interest ${money0(c.interestPaid)} · Principal ${money0(c.principalPaid)}`} />
        <StatCard
          title="Net Cash Flow"
          value={money0(c.netCashFlow)}
          icon={PiggyBank}
          tone={c.netCashFlow.isNegative() ? "danger" : "default"}
          sub={`Invested ${money0(c.investments)} · Savings rate ${c.savingsRatePct.toFixed(1)}%`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
            <CardDescription>Last 6 months, including EMI</CardDescription>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart
              data={d.trend.map((t) => ({
                label: t.label,
                income: t.summary.income.toNumber(),
                expenses: t.summary.expenses.toNumber(),
                emi: t.summary.emi.toNumber(),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Payments</CardTitle>
            <CardDescription>Next 30 days and overdue</CardDescription>
          </CardHeader>
          <CardContent>
            <UpcomingPayments items={d.upcoming} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
            <CardDescription>{monthLabel(ym)}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpenseBreakdownChart data={d.expenseBreakdown.map((e) => ({ name: e.name, value: e.amount.toNumber(), color: e.color }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Credit Cards</CardTitle>
            <CardDescription>Limits, usage and utilization</CardDescription>
          </CardHeader>
          <CardContent>
            <CreditCardSummary cards={d.cards} totals={d.cardTotals} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader>
            <CardTitle>Financial Insights</CardTitle>
            <CardDescription>Rule-based observations from your data</CardDescription>
          </CardHeader>
          <CardContent>
            <InsightsPanel insights={d.insights} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Net Worth Trend</CardTitle>
          <CardDescription>Last snapshot of each month</CardDescription>
        </CardHeader>
        <CardContent>
          <NetWorthChart
            data={d.netWorthTrend.map((p) => ({
              label: monthLabel({ year: p.date.getUTCFullYear(), month: p.date.getUTCMonth() + 1 }, "short").replace(/ (\d{2})(\d{2})$/, " $2"),
              value: p.netWorth.toNumber(),
            }))}
          />
        </CardContent>
      </Card>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        FinSight360 provides personal financial analysis, not financial advice.
      </p>
    </div>
  );
}
