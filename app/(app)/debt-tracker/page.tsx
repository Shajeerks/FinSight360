import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Banknote, CalendarRange, Info, Landmark, Percent, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { resolvePageMonth } from "@/lib/page-month";
import { Decimal, formatMoney } from "@/lib/money";
import { formatDate, formatYearMonth, monthLabel, parseYearMonth } from "@/lib/dates";
import { getDebtTrackerMonth, listDebtLenders } from "@/services/debt-tracker.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { MonthSwitcher } from "@/features/dashboard/components/month-switcher";
import { DebtTrendChart } from "@/features/debt-tracker/charts";
import {
  ApplyAllEmisButton,
  ApplyEmiButton,
  AssignEmi,
  EditEntryDialog,
  ExcelImportDialog,
  LenderDialog,
  UndoExcelButton,
  type EditRowData,
} from "@/features/debt-tracker/components";
import { prisma } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Debt Tracker" };

const KIND_LABEL = { LOAN: "Loan", CARD: "Card", PERSON: "Person", OTHER: "Other" } as const;
const TYPE_LABEL: Record<string, string> = { HOME: "Home loan", CAR: "Car loan", PERSONAL: "Personal loan", EDUCATION: "Education loan", OTHER: "Other loans", CARD: "Credit cards", PERSON: "People", GOLD: "Gold loan", BUSINESS: "Business loan" };

const m0 = (v: Decimal) => formatMoney(v, { decimals: 0 });
const m2 = (v: Decimal) => formatMoney(v);

function Change({ value }: { value: Decimal }) {
  if (value.isZero()) return <span className="text-muted-foreground">—</span>;
  const down = value.isNegative();
  return <span className={cn("tabular", down ? "text-success" : "text-destructive")}>{down ? "▼" : "▲"} {m2(value.abs())}</span>;
}

function Cell({ value, entered, strong }: { value: Decimal | number | null; entered?: boolean; strong?: boolean }) {
  return (
    <td className={cn("tabular whitespace-nowrap px-3 py-2.5 text-right", strong && "font-semibold")}>
      {value === null ? <span className="text-muted-foreground">—</span> : typeof value === "number" ? value : m2(value)}
      {entered && <span className="ml-1 align-super text-[10px] text-primary" title="Entered by you / from Excel">●</span>}
    </td>
  );
}

export default async function DebtTrackerPage(props: PageProps<"/debt-tracker">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const { ym, tz } = await resolvePageMonth(user.id, sp.month);
  const [d, lenders, excelCount] = await Promise.all([
    getDebtTrackerMonth(user.id, formatYearMonth(ym), tz),
    listDebtLenders(user.id),
    prisma.debtMonthEntry.count({ where: { userId: user.id, source: "EXCEL" } }),
  ]);
  const sel = parseYearMonth(d.month)!;
  const now = parseYearMonth(d.current)!;
  const label = monthLabel(sel);
  const t = d.totals;
  const principalPaid = Decimal.max(t.payment.minus(t.interest), 0);
  const pending = d.rows.flatMap((r) => r.pendingEmis.map((e) => ({ ...e, loanId: r.key.slice(5), lender: r.name })));
  const monthlyRate = t.opening.greaterThan(0) ? t.interest.dividedBy(t.opening).times(100) : null;

  const editData = (r: (typeof d.rows)[number]): EditRowData => ({
    key: r.key,
    name: r.name,
    kind: r.kind,
    month: d.month,
    monthLabel: label,
    values: {
      opening: r.row.opening.toFixed(2),
      newBorrowing: r.row.newBorrowing.toFixed(2),
      payment: r.row.payment.toFixed(2),
      paidToDate: r.row.paidToDate.toFixed(2),
      interest: r.row.interest.toFixed(2),
      closing: r.row.closing.toFixed(2),
      remainingEmis: r.row.remainingEmis === null ? null : String(r.row.remainingEmis),
    },
    entered: r.row.entered,
    statementHint: r.statementHint ? { date: formatDate(r.statementHint.date), amount: r.statementHint.amount.toFixed(2), label: r.statementHint.label } : null,
  });

  const actions = (
    <>
      <MonthSwitcher month={sel} current={now} basePath="/debt-tracker" />
      <ExcelImportDialog />
      <LenderDialog />
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Debt Tracker" description="Every card, loan and lender month by month — payments, interest and what's left, worked out from your statements." actions={actions} />

      {d.rows.length === 0 ? (
        <EmptyState
          icon={Scale}
          title={`Nothing owed in ${label}`}
          description="Add your credit cards and loans (or a lender such as a friend), upload bank statements, or import your Excel history to fill this in."
          action={<div className="flex flex-wrap justify-center gap-2"><ExcelImportDialog /><LenderDialog /></div>}
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Month summary">
            <StatCard
              title="Total outstanding"
              value={m0(t.closing)}
              icon={Landmark}
              tone="primary"
              className="col-span-2 xl:col-span-1"
              sub={<span className="inline-flex items-center gap-1">{t.change.isNegative() ? <TrendingDown className="size-3.5 text-success" /> : <TrendingUp className="size-3.5 text-destructive" />}{t.change.isNegative() ? "down" : "up"} {m0(t.change.abs())} vs last month</span>}
            />
            <StatCard title={`Paid in ${monthLabel(sel, "short")}`} value={m0(t.payment)} icon={Banknote} sub={`${m0(principalPaid)} principal · ${m0(t.interest)} interest`} />
            <StatCard
              title="Interest & charges"
              value={m0(t.interest)}
              icon={Percent}
              tone={t.payment.greaterThan(0) && t.interest.greaterThan(t.payment.dividedBy(2)) ? "danger" : "default"}
              sub={monthlyRate ? `${monthlyRate.toFixed(2)}% of opening debt · ≈${monthlyRate.times(12).toFixed(1)}% a year` : "—"}
            />
            <StatCard title={`Interest in ${d.fy.label}`} value={m0(d.fy.interest)} icon={CalendarRange} sub={`Paid ${m0(d.fy.payment)} since April`} />
          </section>

          {pending.length > 0 && (
            <Card className="border-primary/40">
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-base">EMIs found in your bank statement</CardTitle>
                  <CardDescription>Already counted below with estimated interest. Apply them to the loan so the schedule, principal and interest are exact.</CardDescription>
                </div>
                <ApplyAllEmisButton month={d.month} count={pending.length} />
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {pending.map((e) => (
                    <li key={e.transactionId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{e.lender}</p>
                        <p className="truncate text-xs text-muted-foreground">{formatDate(e.date)} · {e.description}{e.account ? ` · ${e.account}` : ""}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3"><span className="tabular font-medium">{m2(e.amount)}</span><ApplyEmiButton loanId={e.loanId} transactionId={e.transactionId} /></div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {(d.unmatchedEmis.length > 0 || d.unassignedCardPayments.length > 0) && (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-600" /> Payments not linked to a lender</CardTitle>
                <CardDescription>These left your bank in {label} but aren&apos;t counted for any lender yet.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {d.unmatchedEmis.map((e) => (
                    <li key={e.transactionId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0"><p className="truncate">{e.description}</p><p className="text-xs text-muted-foreground">EMI · {formatDate(e.date)} · <span className="tabular">{m2(e.amount)}</span></p></div>
                      <AssignEmi transactionId={e.transactionId} loans={d.loans.map((l) => ({ id: l.id, label: l.label }))} />
                    </li>
                  ))}
                  {d.unassignedCardPayments.map((p) => (
                    <li key={p.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0"><p className="truncate">{p.description}</p><p className="text-xs text-muted-foreground">Card payment · {formatDate(p.transactionDate)} · <span className="tabular">{m2(p.amount)}</span></p></div>
                      <Link href={`/transactions?type=CARD_PAYMENT&from=${p.transactionDate.toISOString().slice(0, 10)}&to=${p.transactionDate.toISOString().slice(0, 10)}`} className="text-xs font-medium text-primary hover:underline">Open and choose the card →</Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
              <div>
                <CardTitle>{label} — lender-wise sheet</CardTitle>
                <CardDescription>Remaining balance = Total outstanding + New spends − Payment + Interest. Tap ✎ to type a figure from the lender&apos;s statement; <span className="text-primary">●</span> marks figures you entered.</CardDescription>
              </div>
              {excelCount > 0 && <UndoExcelButton />}
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              {/* Desktop / tablet: the full sheet */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1080px] text-sm [&_td]:px-2 [&_th]:px-2">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">SI#</th>
                      <th className="px-3 py-2 font-medium">Lender</th>
                      <th className="px-3 py-2 text-right font-medium">Total outstanding</th>
                      <th className="px-3 py-2 text-right font-medium">New spends / borrowing</th>
                      <th className="px-3 py-2 text-right font-medium">Current month payment</th>
                      <th className="px-3 py-2 text-right font-medium">Paid by this month</th>
                      <th className="px-3 py-2 text-right font-medium">Interest charged</th>
                      <th className="px-3 py-2 text-right font-medium">Remaining balance</th>
                      <th className="px-3 py-2 text-right font-medium">EMIs left</th>
                      <th className="px-3 py-2 text-right font-medium">Change vs last month</th>
                      <th className="px-2 py-2"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r, i) => (
                      <tr key={r.key} className="border-b align-top last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="max-w-56 px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            {r.href ? <Link href={r.href} className="truncate font-medium hover:underline">{r.name}</Link> : <span className="truncate font-medium">{r.name}</span>}
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">{KIND_LABEL[r.kind]}</Badge>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{r.detail}</p>
                          {r.notes.map((n) => <p key={n.text} className="text-[11px] leading-snug text-muted-foreground">{n.text}</p>)}
                          {!r.row.unreconciled.isZero() && <p className="text-[11px] text-amber-700 dark:text-warning">Entered figures differ by {m2(r.row.unreconciled)}</p>}
                        </td>
                        <Cell value={r.row.opening} entered={r.row.entered.includes("opening")} />
                        <Cell value={r.row.newBorrowing} entered={r.row.entered.includes("newBorrowing")} />
                        <Cell value={r.row.payment} entered={r.row.entered.includes("payment")} />
                        <Cell value={r.row.paidToDate} entered={r.row.entered.includes("paidToDate")} />
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right">
                          {m2(r.row.interest)}
                          {r.row.entered.includes("interest") && <span className="ml-1 align-super text-[10px] text-primary">●</span>}
                          {r.rate && !r.row.interest.isZero() && <p className="text-[11px] text-muted-foreground">{r.rate.monthlyPct.toFixed(2)}% · ≈{r.rate.annualPct.toFixed(1)}% p.a.</p>}
                        </td>
                        <Cell value={r.row.closing} entered={r.row.entered.includes("closing")} strong />
                        <Cell value={r.row.remainingEmis} entered={r.row.entered.includes("remainingEmis")} />
                        <td className="whitespace-nowrap px-3 py-2.5 text-right"><Change value={r.row.changeFromLastMonth} /></td>
                        <td className="px-2 py-1.5"><EditEntryDialog row={editData(r)} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 font-semibold">
                      <td className="px-3 py-2.5" colSpan={2}>Total ({d.rows.length})</td>
                      <Cell value={t.opening} />
                      <Cell value={t.newBorrowing} />
                      <Cell value={t.payment} />
                      <Cell value={t.paidToDate} />
                      <Cell value={t.interest} />
                      <Cell value={t.closing} strong />
                      <Cell value={t.remainingEmis || null} />
                      <td className="whitespace-nowrap px-3 py-2.5 text-right"><Change value={t.change} /></td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Phones: one card per lender */}
              <ul className="divide-y md:hidden">
                {d.rows.map((r, i) => (
                  <li key={r.key} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{i + 1}. {r.name} <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{KIND_LABEL[r.kind]}</Badge></p>
                        <p className="truncate text-xs text-muted-foreground">{r.detail}</p>
                      </div>
                      <EditEntryDialog row={editData(r)} />
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {([
                        ["Total outstanding", r.row.opening, "opening"],
                        ["New spends / borrowing", r.row.newBorrowing, "newBorrowing"],
                        ["Payment this month", r.row.payment, "payment"],
                        ["Paid by this month", r.row.paidToDate, "paidToDate"],
                        ["Interest charged", r.row.interest, "interest"],
                        ["Remaining balance", r.row.closing, "closing"],
                      ] as const).map(([k, v, f]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className={cn("tabular", f === "closing" && "font-semibold")}>{m2(v)}{r.row.entered.includes(f) && <span className="text-primary"> ●</span>}</dd>
                        </div>
                      ))}
                      {r.row.remainingEmis !== null && <div className="flex justify-between gap-2"><dt className="text-muted-foreground">EMIs left</dt><dd className="tabular">{r.row.remainingEmis}</dd></div>}
                      <div className="flex justify-between gap-2"><dt className="text-muted-foreground">vs last month</dt><dd><Change value={r.row.changeFromLastMonth} /></dd></div>
                    </dl>
                  </li>
                ))}
                <li className="grid grid-cols-2 gap-x-4 gap-y-1 bg-muted/40 px-4 py-3 text-xs font-semibold">
                  <span>Total outstanding</span><span className="tabular text-right">{m2(t.opening)}</span>
                  <span>Paid this month</span><span className="tabular text-right">{m2(t.payment)}</span>
                  <span>Interest charged</span><span className="tabular text-right">{m2(t.interest)}</span>
                  <span>Remaining balance</span><span className="tabular text-right">{m2(t.closing)}</span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Debt over the last 12 months</CardTitle>
                <CardDescription>Total outstanding at each month end, and how much of what you paid went to principal vs interest.</CardDescription>
              </CardHeader>
              <CardContent>
                <DebtTrendChart data={d.trend.map((p) => ({ label: monthLabel(parseYearMonth(p.month)!, "short"), closing: p.closing.toNumber(), interest: p.interest.toNumber(), principal: p.principal.toNumber() }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{d.fy.label} so far</CardTitle>
                <CardDescription>Interest and charges by lender, April to {monthLabel(sel, "short")}.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {d.fy.byLender.slice(0, 8).map((x) => {
                    const pct = d.fy.interest.greaterThan(0) ? x.interest.dividedBy(d.fy.interest).times(100).toNumber() : 0;
                    return (
                      <li key={x.key}>
                        <div className="flex justify-between gap-2"><span className="truncate">{x.name}</span><span className="tabular shrink-0 font-medium">{m0(x.interest)}</span></div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-[var(--chart-expense)]" style={{ width: `${Math.max(pct, 1)}%` }} /></div>
                      </li>
                    );
                  })}
                  {d.fy.byLender.length === 0 && <li className="text-muted-foreground">No interest recorded yet this year.</li>}
                </ul>
                {d.fy.byType.length > 0 && (
                  <div className="rounded-lg border p-3 text-xs">
                    <p className="mb-1.5 font-medium">By type (useful at tax time)</p>
                    <table className="w-full">
                      <thead><tr className="text-muted-foreground"><th className="text-left font-normal">Type</th><th className="text-right font-normal">Principal</th><th className="text-right font-normal">Interest</th></tr></thead>
                      <tbody>
                        {d.fy.byType.map((x) => (
                          <tr key={x.type}><td>{TYPE_LABEL[x.type] ?? x.type}</td><td className="tabular text-right">{m0(x.principal)}</td><td className="tabular text-right">{m0(x.interest)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-muted-foreground">Home-loan interest and principal, and education-loan interest, may be deductible depending on your tax regime — check with your CA before filing.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="text-base">Other lenders</CardTitle>
              <CardDescription>People and lenders that aren&apos;t a card or a loan in Loans & EMI.</CardDescription>
            </div>
            <LenderDialog />
          </CardHeader>
          <CardContent>
            {lenders.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet. Cards and loans appear automatically.</p>
            ) : (
              <ul className="divide-y text-sm">
                {lenders.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{l.name} {l.closedAt && <Badge variant="secondary">Repaid</Badge>}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {l.kind === "PERSON" ? "Person" : "Other lender"} · opening {m0(l.openingOutstanding)}{l.monthlyRatePct.greaterThan(0) ? ` · ${l.monthlyRatePct.toFixed(2)}% a month` : " · interest-free"}
                      </p>
                    </div>
                    <LenderDialog
                      trigger="icon"
                      lender={{
                        id: l.id,
                        name: l.name,
                        kind: l.kind,
                        matchText: l.matchText,
                        openingOutstanding: l.openingOutstanding.toFixed(2),
                        openingDate: l.openingDate ? l.openingDate.toISOString().slice(0, 10) : "",
                        monthlyRatePct: l.monthlyRatePct.toString(),
                        notes: l.notes,
                        closed: Boolean(l.closedAt),
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Info className="size-4 text-primary" /> Where the numbers come from</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><b className="text-foreground">Credit cards:</b> spends, refunds, fees and bill payments in FinSight360 (from card and bank statement uploads). If you only upload bank statements, enter the card statement&apos;s balance as the remaining balance — interest is then the balancing figure.</p>
            <p><b className="text-foreground">Loans:</b> payments recorded on the loan, plus EMI debits found in your bank statements (matched by amount and lender name). Interest uses the loan&apos;s rate on the opening balance until the EMI is applied to the loan.</p>
            <p><b className="text-foreground">Other lenders:</b> transactions marked <i>Loan / borrowing</i> that mention them, plus the monthly interest rate you set.</p>
            <p>Each month starts from last month&apos;s remaining balance. Your own figures never change the ledger and can be reset to automatic at any time.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
