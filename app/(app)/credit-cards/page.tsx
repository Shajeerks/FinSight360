import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CreditCard, Gift } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getCreditCardOverview } from "@/services/credit-card.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { toDateInput } from "@/validators/common";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { CreditCardDialog } from "@/features/credit-cards/card-form";
import { DeleteAccountButton } from "@/features/accounts/delete-buttons";
import { AddTransactionButton } from "@/features/transactions/transaction-dialog";
import type { CardDueInfo } from "@/lib/finance/credit-card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Credit Cards" };

function utilColor(pct: number) {
  return pct >= 75 ? "bg-destructive" : pct >= 30 ? "bg-warning" : "bg-success";
}

function DueBadge({ due }: { due: CardDueInfo }) {
  if (due.status === "NO_DUE") return <Badge variant="success">Nothing due</Badge>;
  if (due.status === "OVERDUE") return <Badge variant="destructive">Overdue by {Math.abs(due.daysRemaining ?? 0)}d</Badge>;
  if (due.status === "DUE_TODAY") return <Badge variant="warning">Due today</Badge>;
  if (due.status === "DUE_SOON") return <Badge variant="warning">Due in {due.daysRemaining}d</Badge>;
  return <Badge variant="secondary">Due in {due.daysRemaining}d</Badge>;
}

export default async function CreditCardsPage() {
  const user = await requireUser();
  const [o, options] = await Promise.all([getCreditCardOverview(user.id), getTransactionFormOptions(user.id)]);
  const t = o.totals;

  return (
    <div className="space-y-6">
      <PageHeader title="Credit Cards" description="Limits, dues and utilization — recalculated from your transactions." actions={<CreditCardDialog />} />

      {o.cards.length === 0 ? (
        <EmptyState icon={CreditCard} title="No credit cards yet" description="Add a card with its limit and last four digits. CVV, PIN, OTP and full card numbers are never stored." action={<CreditCardDialog />} />
      ) : (
        <>
          <section aria-label="Card summary" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total credit limit</p><p className="tabular text-lg font-semibold sm:text-2xl">{formatMoney(t.creditLimit, { decimals: 0 })}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total outstanding</p><p className="tabular text-lg font-semibold sm:text-2xl">{formatMoney(t.outstanding, { decimals: 0 })}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Available limit</p><p className="tabular text-lg font-semibold text-success sm:text-2xl">{formatMoney(t.availableLimit, { decimals: 0 })}</p></CardContent></Card>
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="text-xs text-muted-foreground">Overall utilization</p>
                <p className="tabular text-lg font-semibold sm:text-2xl">{t.utilizationPct.toFixed(2)}%</p>
                <Progress value={t.utilizationPct.toNumber()} indicatorClassName={utilColor(t.utilizationPct.toNumber())} label="Overall utilization" />
              </CardContent>
            </Card>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4 text-primary" /> Upcoming due payments</CardTitle><CardDescription>Next 30 days · total due {formatMoney(o.totalDue, { decimals: 0 })}</CardDescription></CardHeader>
              <CardContent>
                {o.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No card payments due in the next 30 days.</p> : (
                  <ul className="divide-y">
                    {o.upcoming.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{c.bankName} {c.cardName} ••{c.last4}</p><p className="text-xs text-muted-foreground">Due {formatDate(c.due.dueDate)} · min {formatMoney(c.remainingMinimum, { decimals: 0 })}</p></div>
                        <div className="flex flex-col items-end gap-1"><span className="tabular text-sm font-semibold">{formatMoney(c.remainingDue, { decimals: 0 })}</span><DueBadge due={c.due} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className={o.overdue.length ? "border-destructive/40" : undefined}>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className={cn("size-4", o.overdue.length ? "text-destructive" : "text-muted-foreground")} /> Overdue cards</CardTitle><CardDescription>Pay these first to avoid late fees and interest</CardDescription></CardHeader>
              <CardContent>
                {o.overdue.length === 0 ? <p className="text-sm text-muted-foreground">No overdue cards. 🎉</p> : (
                  <ul className="divide-y">
                    {o.overdue.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0"><p className="truncate text-sm font-medium">{c.bankName} {c.cardName} ••{c.last4}</p><p className="text-xs text-muted-foreground">Was due {formatDate(c.due.dueDate)}</p></div>
                        <div className="flex flex-col items-end gap-1"><span className="tabular text-sm font-semibold">{formatMoney(c.remainingDue, { decimals: 0 })}</span><DueBadge due={c.due} /></div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <section aria-label="Your cards" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {o.cards.map((c) => {
              const pct = c.utilizationPct.toNumber();
              return (
                <Card key={c.id} className={cn("overflow-hidden", c.status !== "ACTIVE" && "opacity-70")}>
                  <div className="relative bg-gradient-to-br from-slate-800 via-slate-900 to-teal-900 p-4 text-white">
                    <div className="flex items-start justify-between">
                      <div><p className="text-xs uppercase tracking-wider text-white/60">{c.bankName}</p><p className="font-semibold">{c.cardName}</p></div>
                      <span className="text-xs font-semibold uppercase tracking-wide text-white/80">{c.network === "OTHER" ? "" : c.network}</span>
                    </div>
                    <p className="mt-6 font-mono text-lg tracking-[0.2em]">•••• •••• •••• {c.last4}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-white/70">
                      <span>Statement day {c.statementDay ?? "—"}</span>
                      {c.status !== "ACTIVE" && <span className="rounded bg-white/15 px-1.5 py-0.5 uppercase">{c.status}</span>}
                    </div>
                  </div>
                  <CardContent className="space-y-4 p-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[11px] text-muted-foreground">Limit</p><p className="tabular text-sm font-semibold">{formatMoney(c.creditLimit, { decimals: 0 })}</p></div>
                      <div><p className="text-[11px] text-muted-foreground">Used</p><p className="tabular text-sm font-semibold">{formatMoney(c.outstanding, { decimals: 0 })}</p></div>
                      <div><p className="text-[11px] text-muted-foreground">Available</p><p className="tabular text-sm font-semibold text-success">{formatMoney(c.availableLimit, { decimals: 0 })}</p></div>
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-muted-foreground">Utilization{c.aboveAlert ? ` · above your ${o.alertPct.toFixed(0)}% alert` : ""}</span>
                        <span className={cn("tabular font-medium", c.isOverLimit && "text-destructive")}>{c.utilizationPct.toFixed(2)}%</span>
                      </div>
                      <Progress value={pct} indicatorClassName={utilColor(pct)} label={`${c.cardName} utilization`} />
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Due {c.due.dueDate ? formatDate(c.due.dueDate) : "—"}</p>
                        <p className="tabular font-semibold">{formatMoney(c.remainingDue)} <span className="text-xs font-normal text-muted-foreground">· min {formatMoney(c.remainingMinimum, { decimals: 0 })}</span></p>
                        {c.paidThisCycle.greaterThan(0) && <p className="text-xs text-success">Paid {formatMoney(c.paidThisCycle, { decimals: 0 })} of {formatMoney(c.totalAmountDue, { decimals: 0 })} this cycle</p>}
                      </div>
                      <DueBadge due={c.due} />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Gift className="size-3.5" /> {c.rewardPoints.toLocaleString("en-IN")} points</span>
                      <span>Annual fee {formatMoney(c.annualFee, { decimals: 0 })}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                      <AddTransactionButton options={options} kind="CARD_PAYMENT" lockKind label="Record payment" size="sm" variant="outline" defaults={{ creditCardId: c.id, amount: c.remainingDue.greaterThan(0) ? c.remainingDue.toFixed(2) : "", description: `${c.bankName} credit card payment` }} />
                      <Button asChild variant="ghost" size="sm"><Link href={`/transactions?account=card:${c.id}`}>Transactions</Link></Button>
                      <CreditCardDialog
                        trigger="edit"
                        id={c.id}
                        defaults={{
                          bankName: c.bankName, cardName: c.cardName, network: c.network, last4: c.last4, creditLimit: c.creditLimit.toFixed(2),
                          statementDay: c.statementDay ?? "", paymentDueDay: c.paymentDueDay ?? "", currentOutstanding: c.currentOutstanding.toFixed(2),
                          totalAmountDue: c.totalAmountDue.toFixed(2), minimumAmountDue: c.minimumAmountDue.toFixed(2), currentDueDate: toDateInput(c.currentDueDate),
                          annualFee: c.annualFee.toFixed(2), rewardPoints: c.rewardPoints, status: c.status, notes: c.notes ?? "",
                        }}
                      />
                      <DeleteAccountButton id={c.id} kind="card" name={`${c.cardName} ••${c.last4}`} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
