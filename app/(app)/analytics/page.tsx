import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Landmark, Lightbulb, PiggyBank, Receipt, Repeat, Scale, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { resolvePageMonth } from "@/lib/page-month";
import { formatMoney } from "@/lib/money";
import { formatDate, monthLabel } from "@/lib/dates";
import { getAnalytics } from "@/services/analytics.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { NetWorthHistory, TrendChart, WeekdayBars } from "@/features/analytics/charts";
import { BudgetDialog, BudgetRowActions, DetectRecurringButton, RecurringActions } from "@/features/analytics/analytics-controls";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Monthly Analysis" };

const FREQ: Record<string, string> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", QUARTERLY: "quarterly", HALF_YEARLY: "half-yearly", YEARLY: "yearly" };

function Delta({ value, goodWhenUp }: { value: number | null; goodWhenUp: boolean }) {
  if (value === null) return <span className="text-muted-foreground">no data last month</span>;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5", good ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" /> {Math.abs(value)}% vs last month
    </span>
  );
}

export default async function AnalyticsPage(props: PageProps<"/analytics">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const { ym, now } = await resolvePageMonth(user.id, sp.month);
  const [a, options] = await Promise.all([getAnalytics(user.id, ym), getTransactionFormOptions(user.id)]);
  const s = a.summary;
  const expenseCats = options.categories.filter((c) => c.kind === "EXPENSE");
  const pending = a.recurring.rows.filter((r) => r.status === "DETECTED");
  const confirmed = a.recurring.rows.filter((r) => r.status !== "DETECTED");

  return (
    <div className="space-y-6">
      <PageHeader title="Monthly Analysis" description={`How ${monthLabel(ym)} compares, where the money went, and what repeats.`} actions={<MonthSwitcher month={ym} current={now} basePath="/analytics" />} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Month summary">
        <StatCard title="Income" value={formatMoney(s.income, { decimals: 0 })} icon={Wallet} sub={<Delta value={a.comparison.income} goodWhenUp />} />
        <StatCard title="Expenses" value={formatMoney(s.expenses, { decimals: 0 })} icon={Receipt} sub={<Delta value={a.comparison.expenses} goodWhenUp={false} />} />
        <StatCard title="Savings" value={formatMoney(s.savings, { decimals: 0 })} icon={PiggyBank} tone={s.savings.lessThan(0) ? "danger" : "primary"} sub={a.ratios.savingsRate === null ? "—" : `${a.ratios.savingsRate}% of income`} />
        <StatCard title="EMI burden" value={a.ratios.emiRate === null ? "—" : `${a.ratios.emiRate}%`} icon={Landmark} tone={(a.ratios.emiRate ?? 0) > 40 ? "danger" : "default"} sub={`${formatMoney(s.emi, { decimals: 0 })} EMI · invested ${a.ratios.investmentRate ?? 0}%`} />
      </section>

      {a.tips.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {a.tips.map((t) => (
              <p key={t.text} className={cn("flex items-start gap-2 text-sm", t.tone === "warning" ? "text-amber-700 dark:text-warning" : t.tone === "positive" ? "text-success" : "text-muted-foreground")}>
                <Lightbulb className="mt-0.5 size-4 shrink-0" /> {t.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>12-month trend</CardTitle>
          <CardDescription>Income, spending, EMIs and investments by month; the line is what you kept (income − expenses − EMI).</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart data={a.series.map((m) => ({ ...m, label: monthLabel(m.ym, "short").replace(/ \d{2}(\d{2})$/, " $1") }))} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spending by category</CardTitle>
            <CardDescription>vs last month and your 3-month average</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {a.categories.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">No spending recorded this month.</p>
            ) : (
              <ul className="divide-y">
                {a.categories.slice(0, 12).map((c) => (
                  <li key={c.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color ?? "var(--muted-foreground)" }} /><span className="truncate font-medium">{c.name}</span></span>
                      <span className="tabular shrink-0 font-semibold">{formatMoney(c.current, { decimals: 0 })}</span>
                    </div>
                    <Progress value={Math.min(100, c.share)} label={`${c.name} share`} />
                    <p className="text-xs text-muted-foreground">
                      {c.share}% of spending · last month {formatMoney(c.previous, { decimals: 0 })}
                      {c.changePct !== null && <span className={c.changePct > 0 ? "text-destructive" : "text-success"}> ({c.changePct > 0 ? "+" : ""}{c.changePct}%)</span>}
                      {c.vsAveragePct !== null && Math.abs(c.vsAveragePct) >= 25 && <> · {c.vsAveragePct > 0 ? "above" : "below"} your average by {Math.abs(c.vsAveragePct)}%</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Budgets</CardTitle>
              <CardDescription>{monthLabel(ym)}</CardDescription>
            </div>
            <BudgetDialog categories={expenseCats} />
          </CardHeader>
          <CardContent className="p-0">
            {a.budgets.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Set a monthly limit for food, shopping or all spending to see how you&apos;re tracking.</p>
            ) : (
              <ul className="divide-y">
                {a.budgets.map((b) => (
                  <li key={b.id} className="space-y-1.5 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <span className="truncate">{b.name}</span>
                        {b.status === "OVER" && <Badge variant="destructive">Over</Badge>}
                        {b.status === "WARNING" && <Badge variant="warning">{b.usedPct}%</Badge>}
                        {b.period === "YEARLY" && <Badge variant="secondary">Yearly</Badge>}
                      </span>
                      <BudgetRowActions categories={expenseCats} budget={{ id: b.id, name: b.name, categoryId: b.categoryId ?? "", subCategoryId: b.subCategoryId ?? "", period: b.period, amount: b.amount.toString(), alertThresholdPct: String(b.alertThresholdPct) }} />
                    </div>
                    <Progress value={Math.min(100, b.usedPct)} label={`${b.name} used`} indicatorClassName={b.status === "OVER" ? "bg-destructive" : b.status === "WARNING" ? "bg-warning" : undefined} />
                    <p className="text-xs text-muted-foreground">
                      {formatMoney(b.spent, { decimals: 0 })} of {formatMoney(b.amount, { decimals: 0 })} ·{" "}
                      {b.remaining.greaterThanOrEqualTo(0) ? `${formatMoney(b.remaining, { decimals: 0 })} left` : `${formatMoney(b.remaining.negated(), { decimals: 0 })} over`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Repeat className="size-4" /> Recurring commitments</CardTitle>
            <CardDescription>
              Confirmed: about {formatMoney(a.recurring.monthlyOut, { decimals: 0 })} a month out
              {a.recurring.monthlyIn.greaterThan(0) && ` · ${formatMoney(a.recurring.monthlyIn, { decimals: 0 })} a month in`}
            </CardDescription>
          </div>
          <DetectRecurringButton />
        </CardHeader>
        <CardContent className="space-y-4">
          {pending.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5">
              <p className="px-4 pt-3 text-sm font-medium">Found {pending.length} possible recurring payment{pending.length === 1 ? "" : "s"} — confirm the right ones</p>
              <ul className="divide-y">
                {pending.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{FREQ[r.frequency]} · seen {r.occurrenceCount}× · last {r.lastSeenDate ? formatDate(r.lastSeenDate) : "—"}</p>
                    </div>
                    <span className={cn("tabular shrink-0 text-sm font-semibold", r.direction === "CREDIT" && "text-success")}>{formatMoney(r.expectedAmount, { decimals: 0 })}</span>
                    <RecurringActions id={r.id} status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {confirmed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing confirmed yet. Rent, subscriptions, SIPs, insurance and salary show up here once they repeat.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {confirmed.map((r) => (
                <li key={r.id} className={cn("flex items-center gap-3 px-4 py-2.5", r.status === "PAUSED" && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name}{r.status === "PAUSED" && " (paused)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.category?.name ?? "Uncategorized"} · {FREQ[r.frequency]}
                      {r.nextDueDate && ` · next ${formatDate(r.nextDueDate)}`}
                    </p>
                  </div>
                  <span className={cn("tabular shrink-0 text-sm font-semibold", r.direction === "CREDIT" && "text-success")}>{formatMoney(r.expectedAmount, { decimals: 0 })}</span>
                  <RecurringActions id={r.id} status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /> Unusual & large payments</CardTitle>
            <CardDescription>Compared with your own last 6 months</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {a.unusual.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing out of the ordinary this month.</p>
            ) : (
              <ul className="divide-y">
                {a.unusual.map((u) => (
                  <li key={u.id}>
                    <Link href={`/transactions?q=${encodeURIComponent(u.merchant ?? u.description.slice(0, 30))}&from=${u.transactionDate.toISOString().slice(0, 10)}&to=${u.transactionDate.toISOString().slice(0, 10)}`} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{u.merchant ?? u.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(u.transactionDate)} · {u.category ?? "Uncategorized"} · {u.reasons.join(" · ")}</p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(u.amount, { decimals: 0 })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Where the money went</CardTitle>
            <CardDescription>{a.spendCount} payments{a.averageSpend && ` · average ${formatMoney(a.averageSpend, { decimals: 0 })}`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {a.topMerchants.map((m) => (
                <li key={m.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">{m.name} <span className="text-xs text-muted-foreground">×{m.count}</span></span>
                  <span className="tabular shrink-0">{formatMoney(m.amount, { decimals: 0 })}</span>
                </li>
              ))}
            </ul>
            <WeekdayBars data={a.weekday} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Scale className="size-4" /> Net worth</CardTitle>
          <CardDescription>
            {formatMoney(a.netWorth.netWorth.netWorth, { decimals: 0 })} today · assets {formatMoney(a.netWorth.netWorth.totalAssets, { decimals: 0 })} · liabilities {formatMoney(a.netWorth.netWorth.totalLiabilities, { decimals: 0 })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <NetWorthHistory data={a.netWorthHistory} />
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Assets</p>
              <ul className="space-y-1">{a.netWorth.assets.map((x) => <li key={x.group + x.name} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="tabular shrink-0">{formatMoney(x.amount, { decimals: 0 })}</span></li>)}</ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Liabilities</p>
              {a.netWorth.liabilities.length === 0 ? <p className="text-muted-foreground">None</p> : <ul className="space-y-1">{a.netWorth.liabilities.map((x) => <li key={x.group + x.name} className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="tabular shrink-0 text-destructive">{formatMoney(x.amount, { decimals: 0 })}</span></li>)}</ul>}
            </div>
            <Link href="/reports?type=networth" className="inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">Net-worth report →</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
