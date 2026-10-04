import type { Metadata } from "next";
import Link from "next/link";
import { Receipt, Lock, Sparkles } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { pageNumber } from "@/validators/common";
import { resolvePageMonth } from "@/lib/page-month";
import { formatMoney } from "@/lib/money";
import { formatYearMonth, monthLabel, monthRange } from "@/lib/dates";
import { PAYMENT_METHOD_LABELS } from "@/lib/transactions/kinds";
import { getExpenseOverview } from "@/services/income-expense.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { AddTransactionButton } from "@/features/transactions/transaction-dialog";
import { Pagination, TransactionList } from "@/features/transactions/transaction-list";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const user = await requireUser();
  const sp = await searchParams;
  const { ym, now } = await resolvePageMonth(user.id, sp.month);
  const page = pageNumber(sp.page);
  const [o, options] = await Promise.all([getExpenseOverview(user.id, ym, page), getTransactionFormOptions(user.id)]);
  const add = <AddTransactionButton options={options} kind="EXPENSE" label="Add Expense" />;
  const { start, end } = monthRange(ym);
  const from = start.toISOString().slice(0, 10);
  const to = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description={`Where your money went · ${monthLabel(ym)}`}
        actions={<><MonthSwitcher month={ym} current={now} basePath="/expenses" />{add}</>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          title={`Spent in ${monthLabel(ym, "short")}`}
          value={formatMoney(o.total, { decimals: 0 })}
          icon={Receipt}
          tone="primary"
          className="col-span-2 lg:col-span-1"
          trend={o.change ? { pct: o.change.toNumber(), goodWhen: "down", label: "vs last month" } : null}
          sub="EMIs, investments & card bill payments excluded"
        />
        <StatCard title="Fixed" value={formatMoney(o.fixed, { decimals: 0 })} icon={Lock} sub="Rent, bills, insurance…" />
        <StatCard title="Discretionary" value={formatMoney(o.discretionary, { decimals: 0 })} icon={Sparkles} sub="Food, shopping, travel…" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle>By category</CardTitle><CardDescription>Refunds are netted off. Tap a category to see its transactions.</CardDescription></CardHeader>
          <CardContent>
            {o.categories.length === 0 ? <p className="text-sm text-muted-foreground">No spending recorded this month.</p> : (
              <ul className="divide-y">
                {o.categories.map((c) => (
                  <li key={c.id ?? "none"} className="py-3">
                    <Link href={`/transactions?from=${from}&to=${to}&category=${c.id ?? "none"}`} className="group block">
                      <div className="flex items-center gap-3">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: c.color }} />
                        <span className="flex-1 font-medium group-hover:underline">{c.name}</span>
                        <span className="tabular text-xs text-muted-foreground">{c.share.toFixed(1)}%</span>
                        <span className="tabular w-28 text-right font-semibold">{formatMoney(c.amount, { decimals: 0 })}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, c.share.toNumber()))}%`, background: c.color }} />
                      </div>
                      {c.subs.length > 1 || (c.subs[0] && c.subs[0].name !== "General") ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {c.subs.map((s) => `${s.name} ${formatMoney(s.amount, { decimals: 0 })}`).join(" · ")}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle>Payment methods</CardTitle></CardHeader>
          <CardContent>
            {o.paymentMethods.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
              <ul className="space-y-2 text-sm">
                {o.paymentMethods.map((m) => (
                  <li key={m.key} className="flex justify-between"><span>{PAYMENT_METHOD_LABELS[m.key] ?? m.key}</span><span className="tabular font-medium">{formatMoney(m.amount, { decimals: 0 })}</span></li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <TransactionList rows={o.list.rows} options={options} emptyTitle="No expenses this month" emptyDescription="Add an expense or upload a statement (Phase 4)." emptyAction={add} />
      <Pagination page={o.list.page} pages={o.list.pages} total={o.list.total} makeHref={(p) => `/expenses?month=${formatYearMonth(ym)}&page=${p}`} />
    </div>
  );
}
