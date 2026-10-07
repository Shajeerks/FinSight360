import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Landmark, PiggyBank, Receipt, TrendingDown, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getLoanDetail } from "@/services/loan.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { NotFoundError } from "@/lib/errors";
import { formatMoney, sum } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { EditLoanDialog, LOAN_TYPE_LABEL, LoanProgressDialog, RecordLoanPaymentDialog, ReviseRateDialog } from "@/features/loans/loan-forms";
import { DeleteLoanButton, DeleteLoanPaymentButton } from "@/features/loans/loan-buttons";
import { BalanceCurve, PrincipalInterestBars } from "@/features/loans/loan-charts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Loan details" };

const PAYMENT_LABEL: Record<string, string> = { EMI: "EMI", PREPAYMENT: "Prepayment", FORECLOSURE: "Foreclosure", CHARGE: "Charges" };

export default async function LoanDetailPage({ params, searchParams }: PageProps<"/loans/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const showAll = sp.all === "1";
  let d;
  try {
    d = await getLoanDetail(user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const options = await getTransactionFormOptions(user.id);
  const accounts = options.accounts.filter((a) => a.kind !== "card");
  const banks = accounts.filter((a) => a.kind === "bank").map((a) => ({ id: a.ref.slice(5), label: a.label }));
  const { loan, analysis: a } = d;
  const next = d.schedule.find((r) => r.status !== "PAID");
  const active = loan.status === "ACTIVE";
  const firstUnpaidIdx = d.schedule.findIndex((r) => r.status !== "PAID");
  const visible = showAll ? d.schedule : d.schedule.filter((_, i) => i >= Math.max(0, firstUnpaidIdx - 3) && i < Math.max(0, firstUnpaidIdx) + 12);
  const paymentProps = {
    loanId: loan.id,
    accounts,
    defaultAccount: loan.repaymentAccountId ? `bank:${loan.repaymentAccountId}` : undefined,
    emi: loan.emiAmount.toFixed(2),
    outstanding: loan.outstandingPrincipal.toFixed(2),
    nextInstallment: next ? { number: next.installmentNumber, dueDate: formatDate(next.dueDate), amount: next.emiAmount.toFixed(2) } : null,
  };
  // Paid before FinSight360 (entered as "EMIs already paid" / lender outstanding) vs recorded here.
  const opening = d.payments.filter((p) => p.isOpening);
  const recorded = d.payments.filter((p) => !p.isOpening);
  const openingEmis = opening.filter((p) => p.paymentType === "EMI").length;
  const openingExtra = sum(opening.filter((p) => p.paymentType !== "EMI").map((p) => p.amount));
  const openingTotal = sum(opening.map((p) => p.amount));
  const paidTillDate = sum(d.payments.map((p) => p.amount));
  const emisPaidCount = d.schedule.filter((r) => r.status === "PAID").length;

  return (
    <div className="space-y-6">
      <Link href="/loans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> All loans</Link>
      <PageHeader
        title={loan.name}
        description={`${loan.lender} · ${LOAN_TYPE_LABEL[loan.loanType]}${loan.accountLast4 ? ` ••${loan.accountLast4}` : ""} · ${loan.interestRate.toFixed(2)}% ${loan.interestType.toLowerCase()} · EMI ${formatMoney(loan.emiAmount)} ${loan.emiFrequency.toLowerCase().replace("_", "-")}`}
        actions={
          active ? (
            <>
              <RecordLoanPaymentDialog {...paymentProps} />
              <RecordLoanPaymentDialog {...paymentProps} initialType="PREPAYMENT" label="Prepay" variant="outline" />
            </>
          ) : (
            <Badge variant="secondary" className="text-sm">{loan.status === "FORECLOSED" ? "Foreclosed" : "Closed"} {loan.closureDate ? `on ${formatDate(loan.closureDate)}` : ""}</Badge>
          )
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5" aria-label="Loan analysis">
        <StatCard title="Paid till date" value={formatMoney(paidTillDate, { decimals: 0 })} icon={Wallet} sub={`${emisPaidCount} of ${d.schedule.length} EMIs paid${openingTotal.greaterThan(0) ? ` · ${formatMoney(openingTotal, { decimals: 0 })} before FinSight360` : ""}`} />
        <StatCard title="Outstanding principal" value={formatMoney(a.outstanding, { decimals: 0 })} icon={Landmark} tone="primary" sub={`of ${formatMoney(loan.originalPrincipal, { decimals: 0 })} borrowed`} />
        <StatCard title="Principal paid" value={formatMoney(a.principalPaid, { decimals: 0 })} icon={PiggyBank} sub={`${a.repaidPct.toFixed(1)}% repaid${loan.totalPrepayments.greaterThan(0) ? ` · prepaid ${formatMoney(loan.totalPrepayments, { decimals: 0 })}` : ""}`} />
        <StatCard title="Interest paid" value={formatMoney(a.interestPaid, { decimals: 0 })} icon={TrendingDown} sub={`This year ${formatMoney(a.interestPaidThisYear, { decimals: 0 })} · this month ${formatMoney(a.interestPaidThisMonth, { decimals: 0 })}`} />
        <StatCard title="Future interest (est.)" value={formatMoney(a.futureInterest, { decimals: 0 })} icon={Receipt} sub={`Lifetime interest ${a.lifetimeInterestPct.toFixed(1)}% of principal`} />
      </section>

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <div className="mb-1 flex justify-between text-sm"><span>Principal repaid</span><span className="tabular font-medium">{a.repaidPct.toFixed(1)}%</span></div>
            <Progress value={a.repaidPct.toNumber()} label="Principal repaid" />
            <p className="mt-2 text-xs text-muted-foreground">Interest-to-principal ratio so far: {a.interestToPrincipalPct.toFixed(1)}% · charges paid {formatMoney(a.chargesPaid, { decimals: 0 })}</p>
          </div>
          <div><p className="text-xs text-muted-foreground">EMIs remaining</p><p className="text-lg font-semibold">{a.remainingInstallments}{a.overdueCount > 0 && <Badge variant="destructive" className="ml-2 align-middle">{a.overdueCount} overdue</Badge>}</p></div>
          <div><p className="text-xs text-muted-foreground">Projected closure</p><p className="flex items-center gap-1 text-lg font-semibold"><CalendarCheck className="size-4 text-primary" /> {a.projectedClosure ? formatDate(a.projectedClosure) : "—"}</p></div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Principal vs interest by year</CardTitle><CardDescription>Actual payments, then the projected schedule</CardDescription></CardHeader>
          <CardContent><PrincipalInterestBars data={d.yearly.map((y) => ({ label: `${y.year}${y.projected ? "*" : ""}`, principal: y.principal.toNumber(), interest: y.interest.toNumber() }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Outstanding balance</CardTitle><CardDescription>Closing principal after each instalment</CardDescription></CardHeader>
          <CardContent>
            <BalanceCurve data={d.balanceCurve.map((p) => ({ label: formatDate(p.date).slice(3), balance: p.closing.toNumber() }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>EMI schedule</CardTitle>
            <CardDescription>Scheduled vs actual. {showAll ? `All ${d.schedule.length} instalments.` : "Showing the instalments around today."}</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm"><Link href={showAll ? `/loans/${loan.id}` : `/loans/${loan.id}?all=1`} scroll={false}>{showAll ? "Show fewer" : `View full schedule (${d.schedule.length})`}</Link></Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Due date</th>
                  <th className="px-4 py-2.5 text-right font-medium">Opening</th>
                  <th className="px-4 py-2.5 text-right font-medium">EMI</th>
                  <th className="px-4 py-2.5 text-right font-medium">Principal</th>
                  <th className="px-4 py-2.5 text-right font-medium">Interest</th>
                  <th className="px-4 py-2.5 text-right font-medium">Closing</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actual paid</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y tabular">
                {visible.map((r) => (
                  <tr key={r.id} className={cn(r.id === next?.id && "bg-primary/5")}>
                    <td className="px-4 py-2">{r.installmentNumber}</td>
                    <td className="whitespace-nowrap px-4 py-2">{formatDate(r.dueDate)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.openingPrincipal)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatMoney(r.emiAmount)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.principalComponent)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.interestComponent)}</td>
                    <td className="px-4 py-2 text-right">{formatMoney(r.closingPrincipal)}</td>
                    <td className={cn("px-4 py-2 text-right", r.actualPaid.greaterThan(0) && !r.difference.isZero() && "text-amber-600 dark:text-warning")}>
                      {r.actualPaid.greaterThan(0) ? formatMoney(r.actualPaid) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === "PAID" ? <Badge variant="success">Paid</Badge> : r.status === "PARTIALLY_PAID" ? <Badge variant="warning">Part-paid</Badge> : r.overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge variant="secondary">Upcoming</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Payments</CardTitle><CardDescription>Actual payments recorded against this loan</CardDescription></CardHeader>
        <CardContent>
          {d.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <ul className="divide-y">
              {opening.length > 0 && (
                <li className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-24 text-muted-foreground">Before FinSight360</span>
                  <Badge variant="outline">{openingEmis} EMI{openingEmis === 1 ? "" : "s"}{openingExtra.greaterThan(0) ? " + extra principal" : ""}</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Principal {formatMoney(sum(opening.map((p) => p.principalComponent)), { decimals: 0 })} · interest {formatMoney(sum(opening.map((p) => p.interestComponent)), { decimals: 0 })} · not in ledger · change with Update repayment progress
                  </span>
                  <span className="tabular font-semibold">{formatMoney(openingTotal)}</span>
                </li>
              )}
              {recorded.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-24 text-muted-foreground">{formatDate(p.paymentDate)}</span>
                  <Badge variant={p.paymentType === "EMI" ? "secondary" : "default"}>{PAYMENT_LABEL[p.paymentType]}{p.schedule ? ` #${p.schedule.installmentNumber}` : ""}</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Principal {formatMoney(p.principalComponent, { decimals: 0 })} · interest {formatMoney(p.interestComponent, { decimals: 0 })}
                    {p.chargesComponent.greaterThan(0) ? ` · charges ${formatMoney(p.chargesComponent, { decimals: 0 })}` : ""}
                    {p.transaction ? ` · from ${p.transaction.bankAccount?.nickname ?? p.transaction.cashAccount?.name ?? "account"}` : " · not in ledger"}
                  </span>
                  <span className="tabular font-semibold">{formatMoney(p.amount)}</span>
                  <DeleteLoanPaymentButton loanId={loan.id} paymentId={p.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <LoanProgressDialog
          loanId={loan.id}
          totalEmis={d.schedule.length}
          hasRecordedPayments={recorded.length > 0}
          defaults={{ emisPaid: openingEmis, outstandingAsPerBank: "" }}
        />
        {active && <ReviseRateDialog loanId={loan.id} currentRate={loan.interestRate.toFixed(2)} />}
        {active && <RecordLoanPaymentDialog {...paymentProps} initialType="FORECLOSURE" label="Foreclose" variant="outline" size="sm" />}
        <EditLoanDialog
          loanId={loan.id}
          banks={banks}
          defaults={{ name: loan.name, lender: loan.lender, accountLast4: loan.accountLast4 ?? "", interestType: loan.interestType, repaymentAccountId: loan.repaymentAccountId ?? "", notes: loan.notes ?? "" }}
        />
        <DeleteLoanButton id={loan.id} name={loan.name} />
      </div>
    </div>
  );
}
