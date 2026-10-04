import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, ChevronRight, Coins, LineChart, PiggyBank, ShieldCheck, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getPortfolio, investmentFormOptions } from "@/services/investment.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { AllocationBar, PortfolioHistory } from "@/features/investments/charts";
import {
  DeleteInvestmentAccountButton, GrowwImportDialog, HoldingDialog, INSTRUMENT_LABEL, InvestmentAccountDialog, InvestmentTxnDialog, RefreshNavButton,
} from "@/features/investments/investment-forms";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Investments" };

const pct = (v: { toFixed(n: number): string } | null) => (v === null ? "—" : `${Number(v.toFixed(2)) >= 0 ? "+" : ""}${v.toFixed(2)}%`);

export default async function InvestmentsPage() {
  const user = await requireUser();
  const [p, options] = await Promise.all([getPortfolio(user.id), investmentFormOptions(user.id)]);
  const t = p.totals;
  const up = t.gain.greaterThanOrEqualTo(0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investments"
        description="Mutual funds, stocks and ETFs — value, gains, XIRR and allocation. Import from Groww's reports; no broker password or OTP ever."
        actions={
          <div className="flex flex-wrap gap-2">
            <InvestmentAccountDialog />
            {options.length > 0 && <HoldingDialog accounts={options} />}
            {options.length > 0 && <InvestmentTxnDialog accounts={options} />}
          </div>
        }
      />

      {options.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No investment accounts yet"
          description="Add your Groww (or any other) account, then import its holdings statement or add holdings yourself."
          action={<InvestmentAccountDialog />}
        />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Portfolio summary">
            <StatCard title="Current value" value={formatMoney(t.current, { decimals: 0 })} icon={PiggyBank} tone="primary" className="col-span-2 xl:col-span-1" sub={`${t.holdings} holding${t.holdings === 1 ? "" : "s"}`} />
            <StatCard title="Invested" value={formatMoney(t.invested, { decimals: 0 })} icon={Coins} />
            <StatCard title="Unrealised gain" value={formatMoney(t.gain, { decimals: 0 })} icon={up ? TrendingUp : LineChart} tone={up ? "default" : "danger"} sub={pct(t.gainPct)} />
            <StatCard title="XIRR" value={t.xirr === null ? "—" : `${t.xirr.toFixed(2)}%`} icon={BadgePercent} sub={t.xirr === null ? "Add buy/sell history to see XIRR" : t.xirrHoldings < t.holdings ? `From ${t.xirrHoldings} holding${t.xirrHoldings === 1 ? "" : "s"} with history` : `Realised + dividends ${formatMoney(t.realized, { decimals: 0 })}`} />
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Asset allocation</CardTitle>
                <CardDescription>By current value</CardDescription>
              </CardHeader>
              <CardContent>
                {p.allocation.length ? <AllocationBar data={p.allocation.map((a) => ({ label: a.label, current: a.current.toNumber(), pct: a.pct }))} /> : <p className="text-sm text-muted-foreground">Add holdings to see your allocation.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle>Portfolio value</CardTitle>
                  <CardDescription>Value vs amount invested over time</CardDescription>
                </div>
                <RefreshNavButton />
              </CardHeader>
              <CardContent>
                <PortfolioHistory data={p.history} />
              </CardContent>
            </Card>
          </div>

          {(p.topGainers.length > 0 || p.topLosers.length > 0) && (
            <Card>
              <CardHeader><CardTitle>Best and worst performers</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[...p.topGainers, ...p.topLosers.filter((l) => !p.topGainers.some((g) => g.id === l.id))].map((h) => (
                  <Link key={h.id} href={`/investments/${h.id}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="min-w-0 truncate">{h.instrumentName}</span>
                    <span className={cn("tabular shrink-0 font-semibold", h.gain.lessThan(0) ? "text-destructive" : "text-success")}>{pct(h.gainPct)}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {p.accounts.map((a) => {
            const opt = options.find((o) => o.id === a.id)!;
            return (
              <Card key={a.id}>
                <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {a.name}
                      {a.providerType === "GROWW" && <Badge variant="secondary">Groww</Badge>}
                    </CardTitle>
                    <CardDescription>
                      {formatMoney(a.current, { decimals: 0 })} · invested {formatMoney(a.invested, { decimals: 0 })} ·{" "}
                      <span className={a.gain.lessThan(0) ? "text-destructive" : "text-success"}>{formatMoney(a.gain, { decimals: 0 })}</span>
                      {a.lastImportAt && ` · last import ${formatDate(a.lastImportAt)}`}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <GrowwImportDialog accountId={a.id} accountName={a.name} />
                    <InvestmentAccountDialog account={{ id: a.id, name: a.name, providerType: a.providerType, accountType: a.accountType }} trigger={<button type="button" className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted">Edit</button>} />
                    <DeleteInvestmentAccountButton id={a.id} name={a.name} />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {a.holdings.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center text-sm text-muted-foreground">
                      <p>No holdings yet. Import the holdings statement from Groww, or add them yourself.</p>
                      <div className="flex flex-wrap justify-center gap-2"><HoldingDialog accounts={[opt]} /><InvestmentTxnDialog accounts={[opt]} /></div>
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {a.holdings.map((h) => (
                        <li key={h.id}>
                          <Link href={`/investments/${h.id}`} className="grid gap-1 px-4 py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/60 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{h.instrumentName}</p>
                              <p className="text-xs text-muted-foreground">
                                {INSTRUMENT_LABEL[h.instrumentType]} · {h.quantity.toString()} units · avg ₹{h.averageBuyPrice.toFixed(2)}
                                {h.currentPrice ? ` · now ₹${h.currentPrice.toFixed(2)}` : " · no price yet"}
                              </p>
                            </div>
                            <div className="text-left sm:text-right">
                              <p className="tabular text-sm font-semibold">{formatMoney(h.current)}</p>
                              <p className="tabular text-xs text-muted-foreground">invested {formatMoney(h.invested, { decimals: 0 })}</p>
                            </div>
                            <div className="flex items-center justify-between gap-2 sm:justify-end">
                              <span className={cn("tabular text-sm font-semibold", h.gain.lessThan(0) ? "text-destructive" : "text-success")}>
                                {pct(h.gainPct)}
                                {h.xirr !== null && <span className="ml-2 text-xs font-normal text-muted-foreground">XIRR {h.xirr.toFixed(1)}%</span>}
                              </span>
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
              <p>
                <strong className="text-foreground">Groww:</strong> FinSight360 imports the reports you download from Groww (Holdings statement for stocks or mutual funds, and Transactions / Order history). It never asks for your Groww password or OTP and doesn&apos;t use unofficial APIs. Mutual-fund NAVs come from AMFI&apos;s public daily NAV file (needs each fund&apos;s ISIN); stock prices come from your latest holdings statement or the price you enter.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
