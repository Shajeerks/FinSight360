import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Landmark, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { resolvePageMonth } from "@/lib/page-month";
import { formatMoney } from "@/lib/money";
import { formatDate, formatYearMonth, monthLabel, parseYearMonth } from "@/lib/dates";
import { getPayPlan, type PayPlan } from "@/services/pay-plan.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { DebtTrendChart } from "@/features/debt-tracker/charts";
import { ExcelImportDialog } from "@/features/debt-tracker/components";
import { ClosingPlanner } from "@/features/plan/closing-planner";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pay & Close" };

const m0 = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, { decimals: 0 });
const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" | "default" }> = {
  PAID: { label: "Paid", variant: "success" },
  MIN_PAID: { label: "Min. paid", variant: "warning" },
  PART_PAID: { label: "Part paid", variant: "warning" },
  DUE: { label: "Due", variant: "default" },
  OVERDUE: { label: "Overdue", variant: "destructive" },
  NO_DUE: { label: "Nothing due", variant: "secondary" },
};

function PayRow({ i }: { i: PayPlan["items"][number] }) {
  const st = STATUS[i.status] ?? STATUS.DUE;
  const urgent = i.status === "OVERDUE";
  const soon = !urgent && i.status !== "PAID" && i.daysLeft !== null && i.daysLeft >= 0 && i.daysLeft <= 3;
  return (
    <li className={cn("flex items-center justify-between gap-3 px-3 py-2.5", urgent && "bg-destructive/5", soon && "bg-amber-500/5")}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {i.href ? <Link href={i.href} className="hover:underline">{i.name}</Link> : i.name}{" "}
          <span className="text-xs font-normal text-muted-foreground">{i.commitment ? "· commitment" : i.kind === "CARD" ? "· card" : i.kind === "LOAN" ? "· loan" : ""}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {i.dueDate ? `Due ${formatDate(i.dueDate)}` : "No due date"}
          {i.status !== "PAID" && i.daysLeft !== null ? (i.daysLeft < 0 ? ` · ${-i.daysLeft} day(s) late` : i.daysLeft === 0 ? " · today" : ` · in ${i.daysLeft} day(s)`) : ""}
          {i.paid.greaterThan(0) ? ` · paid ${m0(i.paid)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="tabular text-sm font-semibold">{m0(i.status === "PAID" ? i.amountDue : i.left)}</span>
        <Badge variant={soon ? "warning" : st.variant}>{soon ? (i.daysLeft === 0 ? "Due today" : `In ${i.daysLeft}d`) : st.label}</Badge>
      </div>
    </li>
  );
}

export default async function PayPlanPage(props: PageProps<"/plan">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const { ym, tz } = await resolvePageMonth(user.id, sp.month);
  const p = await getPayPlan(user.id, formatYearMonth(ym), tz);
  const sel = parseYearMonth(p.month)!;
  const now = parseYearMonth(p.current)!;
  const label = monthLabel(sel);
  const t = p.totals;
  const open = p.items.filter((i) => i.status !== "PAID" && i.status !== "NO_DUE");
  const done = p.items.filter((i) => i.status === "PAID" || i.status === "NO_DUE");
  const paidPct = t.due.greaterThan(0) ? Math.min(100, t.paid.dividedBy(t.due).times(100).toNumber()) : 0;
  const next = open.find((i) => i.dueDate && (i.daysLeft ?? -1) >= 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pay & Close"
        description="This month on one page: what to pay and by when, what you owe, and which debts to close first."
        actions={<><MonthSwitcher month={sel} current={now} basePath="/plan" /><ExcelImportDialog /></>}
      />

      {p.items.length === 0 && p.closing.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={`Nothing to pay in ${label}`}
          description="Import your financial-year Excel sheet, or add your cards and loans, and this page fills in."
          action={<ExcelImportDialog />}
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="This month">
            <StatCard
              title={`Still to pay in ${monthLabel(sel, "short")}`}
              value={m0(t.left)}
              icon={CalendarClock}
              tone={t.overdue ? "danger" : "primary"}
              className="col-span-2 xl:col-span-1"
              sub={t.overdue ? `${t.overdue} overdue${next ? ` · next: ${next.name} ${formatDate(next.dueDate)}` : ""}` : next ? `Next: ${next.name} on ${formatDate(next.dueDate)}` : "Nothing else due"}
            />
            <StatCard title="Paid so far" value={m0(t.paid)} icon={CheckCircle2} sub={`of ${m0(t.due)} due · ${paidPct.toFixed(0)}%`} />
            <StatCard
              title="Total outstanding"
              value={m0(p.outstanding.end)}
              icon={Landmark}
              sub={<span className="inline-flex items-center gap-1">{p.outstanding.change.isNegative() ? <TrendingDown className="size-3.5 text-success" /> : <TrendingUp className="size-3.5 text-destructive" />}{p.outstanding.change.isNegative() ? "down" : "up"} {m0(p.outstanding.change.abs())} vs last month</span>}
            />
            <StatCard
              title="Income left after payments"
              value={p.income ? m0(p.income.afterPayments) : "—"}
              icon={Wallet}
              tone={p.income && p.income.afterPayments.isNegative() ? "danger" : "default"}
              sub={p.income ? `Income ${m0(p.income.total)} − due ${m0(t.due)}` : "Add salary & income for this month via the Excel import"}
            />
          </section>

          <Card>
            <CardContent className="space-y-1.5 p-4">
              <div className="flex justify-between text-sm"><span>{label}: {m0(t.paid)} paid of {m0(t.due)}</span><span className="text-muted-foreground">{t.commitments.greaterThan(0) ? `incl. ${m0(t.commitments)} commitments` : ""}</span></div>
              <Progress value={paidPct} label="Paid this month" />
            </CardContent>
          </Card>

          {p.pendingReview > 0 && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-500/40 p-3 text-sm"><AlertTriangle className="size-4 text-amber-600" /> {p.pendingReview} card / loan transaction(s) for {label} are waiting in the <Link href="/imports/review" className="font-medium text-primary hover:underline">Review Queue</Link> and aren&apos;t counted yet.</p>
          )}

          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Pay on time</CardTitle>
                <CardDescription>Everything due in {label}, earliest first. Amounts come from your statements, loan schedules and your sheet; payments from your bank statements.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 px-0 sm:px-6">
                {open.length > 0 ? <ul className="divide-y rounded-lg border">{open.map((i) => <PayRow key={i.key} i={i} />)}</ul> : <p className="px-4 text-sm text-success sm:px-0">Everything due this month is paid.</p>}
                {done.length > 0 && (
                  <details className="px-4 sm:px-0">
                    <summary className="cursor-pointer text-sm text-muted-foreground">Paid ({done.length})</summary>
                    <ul className="mt-2 divide-y rounded-lg border">{done.map((i) => <PayRow key={i.key} i={i} />)}</ul>
                  </details>
                )}
                <p className="px-4 text-xs text-muted-foreground sm:px-0">To fix an amount or mark a payment, open the <Link href={`/debt-tracker?month=${p.month}`} className="font-medium text-primary hover:underline">Debt Tracker</Link> and tap ✎ on the lender.</p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>What changed vs last month</CardTitle>
                <CardDescription>Outstanding went from {m0(p.outstanding.prevClosing)} to {m0(p.outstanding.end)}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {p.moves.up.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-destructive">Went up</p>
                    <ul className="space-y-1">{p.moves.up.map((m) => <li key={m.key} className="flex justify-between gap-2"><span className="truncate">{m.name}</span><span className="tabular">+{m0(m.change)}</span></li>)}</ul>
                  </div>
                )}
                {p.moves.down.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-success">Went down</p>
                    <ul className="space-y-1">{p.moves.down.map((m) => <li key={m.key} className="flex justify-between gap-2"><span className="truncate">{m.name}</span><span className="tabular">−{m0(m.change.abs())}</span></li>)}</ul>
                  </div>
                )}
                {!p.moves.up.length && !p.moves.down.length && <p className="text-muted-foreground">No change recorded yet this month.</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Focus on closing</CardTitle>
              <CardDescription>Smallest balances first — closing them frees their monthly payment for the next one.</CardDescription>
            </CardHeader>
            <CardContent>
              <ClosingPlanner
                month={p.month}
                debts={p.closing.map((c) => ({ key: c.key, name: c.name, kind: c.kind, href: c.href, balance: c.balance.toNumber(), monthly: c.monthly.toNumber(), emisLeft: c.emisLeft, rate: c.rate ? Number(c.rate) : null }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{p.fy} so far</CardTitle>
              <CardDescription>Total outstanding at each month end, and what your payments did each month.</CardDescription>
            </CardHeader>
            <CardContent>
              <DebtTrendChart data={p.trend.map((x) => ({ label: monthLabel(parseYearMonth(x.month)!, "short"), closing: x.closing.toNumber(), interest: x.interest.toNumber(), principal: x.principal.toNumber() }))} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
