import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { pageNumber } from "@/validators/common";
import { resolvePageMonth } from "@/lib/page-month";
import { formatMoney } from "@/lib/money";
import { formatYearMonth, monthLabel } from "@/lib/dates";
import { INCOME_CATEGORY_LABELS } from "@/lib/transactions/kinds";
import { getIncomeOverview } from "@/services/income-expense.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { AddTransactionButton } from "@/features/transactions/transaction-dialog";
import { Pagination, TransactionList } from "@/features/transactions/transaction-list";

export const metadata: Metadata = { title: "Income" };

export default async function IncomePage({ searchParams }: PageProps<"/income">) {
  const user = await requireUser();
  const sp = await searchParams;
  const { ym, now } = await resolvePageMonth(user.id, sp.month);
  const page = pageNumber(sp.page);
  const [o, options] = await Promise.all([getIncomeOverview(user.id, ym, page), getTransactionFormOptions(user.id)]);
  const add = <AddTransactionButton options={options} kind="INCOME" lockKind label="Add Income" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Income"
        description={`Salary, freelance, rent, interest and more · ${monthLabel(ym)}`}
        actions={<><MonthSwitcher month={ym} current={now} basePath="/income" />{add}</>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          title={`Income in ${monthLabel(ym, "short")}`}
          value={formatMoney(o.total, { decimals: 0 })}
          icon={Wallet}
          tone="primary"
          trend={o.change ? { pct: o.change.toNumber(), goodWhen: "up", label: "vs last month" } : null}
        />
        <Card className="sm:col-span-2">
          <CardHeader className="pb-2"><CardTitle>By income type</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {o.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No income recorded this month.</p>}
            {o.byCategory.map((c) => (
              <div key={c.key}>
                <div className="mb-1 flex justify-between text-sm"><span>{INCOME_CATEGORY_LABELS[c.key] ?? c.key}</span><span className="tabular font-medium">{formatMoney(c.amount, { decimals: 0 })} <span className="text-xs text-muted-foreground">({c.share.toFixed(0)}%)</span></span></div>
                <Progress value={c.share.toNumber()} indicatorClassName="bg-chart-income" label={`${c.key} share`} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {o.bySource.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle>Top sources</CardTitle><CardDescription>Who paid you this month</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {o.bySource.map((s) => (
              <span key={s.key} className="rounded-full border bg-muted/40 px-3 py-1 text-sm">{s.key} · <span className="tabular font-medium">{formatMoney(s.amount, { decimals: 0 })}</span></span>
            ))}
          </CardContent>
        </Card>
      )}
      <TransactionList rows={o.list.rows} options={options} emptyTitle="No income this month" emptyDescription="Record salary, freelance payments, rent received or interest." emptyAction={add} />
      <Pagination page={o.list.page} pages={o.list.pages} total={o.list.total} makeHref={(p) => `/income?month=${formatYearMonth(ym)}&page=${p}`} />
    </div>
  );
}
