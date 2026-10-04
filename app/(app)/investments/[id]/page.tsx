import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgePercent, Coins, PiggyBank, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getHoldingDetail, investmentFormOptions } from "@/services/investment.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { PriceHistory } from "@/features/investments/charts";
import { DeleteHoldingButton, DeleteInvestmentTxnButton, EditHoldingButton, INSTRUMENT_LABEL, InvestmentTxnDialog, PriceDialog, TXN_LABEL } from "@/features/investments/investment-forms";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Holding" };

const SOURCE: Record<string, string> = { MANUAL: "Manual", GROWW: "Groww file" };

export default async function HoldingPage(props: PageProps<"/investments/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  let d;
  try {
    d = await getHoldingDetail(user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const options = await investmentFormOptions(user.id);
  const { holding: h, value: v } = d;
  const accountOpt = options.filter((o) => o.id === h.investmentAccountId);

  return (
    <div className="space-y-6">
      <Link href="/investments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Portfolio</Link>
      <PageHeader
        title={h.instrumentName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{INSTRUMENT_LABEL[h.instrumentType]}</Badge>
            <span>{d.account.name}</span>
            {h.isin && <span>· ISIN {h.isin}</span>}
            {h.symbol && <span>· {h.symbol}</span>}
            {h.lastPricedAt && <span>· priced {formatDate(h.lastPricedAt)}</span>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <InvestmentTxnDialog accounts={accountOpt} holdingId={h.id} accountId={h.investmentAccountId} />
            <PriceDialog id={h.id} current={h.currentPrice?.toString() ?? null} name={h.instrumentName} />
            <EditHoldingButton
              accounts={accountOpt}
              hasTransactions={d.transactions.length > 0}
              holding={{ id: h.id, investmentAccountId: h.investmentAccountId, instrumentName: h.instrumentName, instrumentType: h.instrumentType, isin: h.isin ?? "", symbol: h.symbol ?? "", quantity: h.quantity.toString(), averageBuyPrice: h.averageBuyPrice.toString(), investedAmount: "", currentPrice: h.currentPrice?.toString() ?? "" }}
            />
            <DeleteHoldingButton id={h.id} name={h.instrumentName} />
          </div>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Holding summary">
        <StatCard title="Current value" value={formatMoney(v.current)} icon={PiggyBank} tone="primary" sub={`${h.quantity.toString()} units${h.currentPrice ? ` × ₹${h.currentPrice.toFixed(2)}` : ""}`} />
        <StatCard title="Invested" value={formatMoney(v.invested)} icon={Coins} sub={`Average ₹${h.averageBuyPrice.toFixed(4)}`} />
        <StatCard title="Unrealised gain" value={formatMoney(v.gain)} icon={TrendingUp} tone={v.gain.lessThan(0) ? "danger" : "default"} sub={v.gainPct === null ? undefined : `${v.gainPct.toFixed(2)}%`} />
        <StatCard title="XIRR" value={d.xirr === null ? "—" : `${d.xirr.toFixed(2)}%`} icon={BadgePercent} sub={`Realised + dividends ${formatMoney(h.realizedGainLoss)}`} />
      </section>

      <Card>
        <CardHeader><CardTitle>Price history</CardTitle><CardDescription>From AMFI NAVs, Groww statements and prices you entered</CardDescription></CardHeader>
        <CardContent><PriceHistory data={d.prices} /></CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>{d.transactions.length ? "Units, average cost and gains are calculated from these (weighted average cost)." : "This holding was entered as it stands today. Add transactions for exact gains and XIRR."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {d.transactions.length === 0 ? null : (
            <ul className="divide-y">
              {d.transactions.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{TXN_LABEL[t.type] ?? t.type} · {formatDate(t.tradeDate)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.type === "DIVIDEND" ? "Dividend" : `${t.quantity.toString()} units @ ₹${t.price.toFixed(4)}`}
                      {t.charges.greaterThan(0) ? ` · charges ₹${t.charges.toFixed(2)}` : ""} · {SOURCE[t.sourceType] ?? t.sourceType}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </p>
                  </div>
                  <span className={cn("tabular whitespace-nowrap text-sm font-semibold", ["SELL", "REDEMPTION", "SWITCH_OUT", "DIVIDEND"].includes(t.type) && "text-success")}>
                    {["SELL", "REDEMPTION", "SWITCH_OUT", "DIVIDEND"].includes(t.type) ? "+" : ["BONUS", "SPLIT"].includes(t.type) ? "" : "−"}
                    {formatMoney(t.amount)}
                  </span>
                  <DeleteInvestmentTxnButton id={t.id} holdingId={h.id} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
