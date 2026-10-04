import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatMoney } from "@/lib/money";
import type { DashboardData } from "@/services/dashboard.service";
import { cn } from "@/lib/utils";

function utilColor(pct: number) {
  if (pct >= 75) return "bg-destructive";
  if (pct >= 30) return "bg-warning";
  return "bg-success";
}

export function CreditCardSummary({ cards, totals }: { cards: DashboardData["cards"]; totals: DashboardData["cardTotals"] }) {
  if (!cards.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <CreditCard className="size-8 text-muted-foreground/60" />
        No credit cards added yet.
        <Link href="/credit-cards" className="text-primary hover:underline">Add Credit Card</Link>
      </div>
    );
  }
  const overall = totals.utilizationPct.toNumber();
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted/60 p-2">
          <p className="text-[11px] text-muted-foreground">Limit</p>
          <p className="tabular text-sm font-semibold">{formatMoney(totals.creditLimit, { compact: true })}</p>
        </div>
        <div className="rounded-lg bg-muted/60 p-2">
          <p className="text-[11px] text-muted-foreground">Outstanding</p>
          <p className="tabular text-sm font-semibold">{formatMoney(totals.outstanding, { compact: true })}</p>
        </div>
        <div className="rounded-lg bg-muted/60 p-2">
          <p className="text-[11px] text-muted-foreground">Available</p>
          <p className="tabular text-sm font-semibold">{formatMoney(totals.availableLimit, { compact: true })}</p>
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-muted-foreground">Overall utilization</span>
          <span className="tabular font-medium">{overall.toFixed(1)}%</span>
        </div>
        <Progress value={overall} indicatorClassName={utilColor(overall)} label="Overall credit utilization" />
      </div>
      <ul className="space-y-3">
        {cards.map((c) => {
          const pct = c.utilizationPct.toNumber();
          return (
            <li key={c.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">
                  {c.bankName} {c.cardName} <span className="text-xs text-muted-foreground">•••• {c.last4}</span>
                </span>
                <span className={cn("tabular text-xs font-medium", c.isOverLimit && "text-destructive")}>{pct.toFixed(1)}%</span>
              </div>
              <Progress value={pct} indicatorClassName={utilColor(pct)} label={`${c.cardName} utilization`} className="h-1.5" />
              <p className="tabular mt-1 text-xs text-muted-foreground">
                {formatMoney(c.outstanding, { decimals: 0 })} of {formatMoney(c.creditLimit, { decimals: 0 })}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
