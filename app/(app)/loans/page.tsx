import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Banknote, CalendarClock, HandCoins, Landmark, TrendingDown } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getLoansOverview } from "@/services/loan.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { formatMoney } from "@/lib/money";
import { formatDate, monthLabel } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { AddLoanDialog, LOAN_TYPE_LABEL } from "@/features/loans/loan-forms";
import { PrincipalInterestBars } from "@/features/loans/loan-charts";

export const metadata: Metadata = { title: "Loans & EMI" };

export default async function LoansPage() {
  const user = await requireUser();
  const [o, options] = await Promise.all([getLoansOverview(user.id), getTransactionFormOptions(user.id)]);
  const banks = options.accounts.filter((a) => a.kind === "bank").map((a) => ({ id: a.ref.slice(5), label: a.label }));
  const t = o.totals;

  return (
    <div className="space-y-6">
      <PageHeader title="Loans & EMI" description="Amortization schedules, actual payments and interest — all calculated exactly." actions={<AddLoanDialog banks={banks} />} />

      {o.loans.length === 0 ? (
        <EmptyState icon={HandCoins} title="No loans yet" description="Add a home, car, personal or education loan to see its EMI schedule and interest." action={<AddLoanDialog banks={banks} />} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Loan summary">
            <StatCard title="Outstanding principal" value={formatMoney(t.outstanding, { decimals: 0 })} icon={Landmark} tone="primary" className="col-span-2 xl:col-span-1" sub={`${o.loans.filter((l) => l.status === "ACTIVE").length} active loan(s)`} />
            <StatCard title="Monthly EMI commitment" value={formatMoney(t.monthlyEmi, { decimals: 0 })} icon={Banknote} />
            <StatCard title="Interest paid this year" value={formatMoney(t.interestPaidThisYear, { decimals: 0 })} icon={TrendingDown} sub={`This month ${formatMoney(t.interestPaidThisMonth, { decimals: 0 })}`} />
            <StatCard title="Future interest (estimated)" value={formatMoney(t.futureInterest, { decimals: 0 })} icon={CalendarClock} sub="If you pay as scheduled" />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Interest analysis</CardTitle>
              <CardDescription>
                Total paid so far: principal {formatMoney(t.principalPaid, { decimals: 0 })} · interest {formatMoney(t.interestPaid, { decimals: 0 })} · interest is {t.interestToPrincipalPct.toFixed(1)}% of principal repaid
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrincipalInterestBars
                data={o.monthly.map((m) => ({ label: monthLabel({ year: Number(m.key.slice(0, 4)), month: Number(m.key.slice(5)) }, "short").replace(/ \d{2}(\d{2})$/, " $1"), principal: m.principal.toNumber(), interest: m.interest.toNumber() }))}
              />
            </CardContent>
          </Card>

          <section className="grid gap-4 md:grid-cols-2" aria-label="Your loans">
            {o.loans.map((l) => (
              <Link key={l.id} href={`/loans/${l.id}`} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <Card className={`h-full transition-colors hover:border-primary/40 ${l.status !== "ACTIVE" ? "opacity-75" : ""}`}>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{l.name}</CardTitle>
                      <CardDescription>{l.lender} · {LOAN_TYPE_LABEL[l.loanType]} · {l.interestRate.toFixed(2)}% {l.interestType.toLowerCase()}</CardDescription>
                    </div>
                    {l.status === "ACTIVE" ? (
                      l.overdueCount > 0 ? <Badge variant="destructive"><AlertTriangle /> {l.overdueCount} overdue</Badge> : <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">{l.status === "FORECLOSED" ? "Foreclosed" : "Closed"}</Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[11px] text-muted-foreground">Outstanding</p><p className="tabular text-sm font-semibold">{formatMoney(l.outstandingPrincipal, { decimals: 0 })}</p></div>
                      <div><p className="text-[11px] text-muted-foreground">EMI</p><p className="tabular text-sm font-semibold">{formatMoney(l.emiAmount, { decimals: 0 })}</p></div>
                      <div><p className="text-[11px] text-muted-foreground">EMIs left</p><p className="tabular text-sm font-semibold">{l.remainingInstallments}</p></div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">Principal repaid</span><span className="tabular font-medium">{l.repaidPct.toFixed(1)}%</span></div>
                      <Progress value={l.repaidPct.toNumber()} label={`${l.name} repaid`} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {l.nextDue ? (
                        <span className={l.nextDue.overdue ? "font-medium text-destructive" : ""}>
                          EMI #{l.nextDue.installmentNumber} {l.nextDue.overdue ? "was due" : "due"} {formatDate(l.nextDue.dueDate)} · {formatMoney(l.nextDue.amount, { decimals: 0 })}
                        </span>
                      ) : (
                        <span>Fully repaid</span>
                      )}
                      <span>Interest paid {formatMoney(l.interestPaid, { decimals: 0 })}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
