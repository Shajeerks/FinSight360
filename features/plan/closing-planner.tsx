"use client";
import * as React from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { monthsToClose, snowball, type PlanDebt } from "@/lib/finance/closing-plan";
import { cn } from "@/lib/utils";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function label(start: string, add: number | null) {
  if (add === null) return "—";
  if (add === 0) return "Closed";
  const [y, m] = start.split("-").map(Number);
  const t = y * 12 + (m - 1) + add;
  return `${MONTHS[t % 12]} ${Math.floor(t / 12)}`;
}

/** Each debt's closing month at today's pace, and with an extra amount each month (smallest first). */
export function ClosingPlanner({ debts, month }: { debts: (PlanDebt & { href: string | null; kind: string; rate: number | null })[]; month: string }) {
  const [extra, setExtra] = React.useState("");
  const x = Math.max(Number(extra.replace(/[^\d.]/g, "")) || 0, 0);
  const base = new Map(debts.map((d) => [d.key, monthsToClose(d)]));
  const plan = new Map(snowball(debts, x).map((r) => [r.key, r.months]));
  const lastBase = Math.max(0, ...[...base.values()].map((v) => v ?? 0));
  const lastPlan = Math.max(0, ...[...plan.values()].map((v) => v ?? 0));
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor="extra" className="text-sm">
          Extra I can pay each month <span className="text-muted-foreground">(goes to the smallest balance first, then rolls over)</span>
        </label>
        <Input id="extra" inputMode="numeric" className="h-9 sm:w-40" placeholder="e.g. 5000" value={extra} onChange={(e) => setExtra(e.target.value)} />
      </div>
      <p className="text-sm">
        Debt-free by <strong>{label(month, lastBase || null)}</strong> at today&apos;s pace
        {x > 0 && lastPlan > 0 && <> · with {inr(x)} extra: <strong className="text-success">{label(month, lastPlan)}</strong>{lastBase > lastPlan && <> ({lastBase - lastPlan} month(s) sooner)</>}</>}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">#</th>
              <th className="px-2 py-2 font-medium">Lender</th>
              <th className="px-2 py-2 text-right font-medium">Balance</th>
              <th className="px-2 py-2 text-right font-medium">Pays / month</th>
              <th className="px-2 py-2 text-right font-medium">Closes</th>
              {x > 0 && <th className="px-2 py-2 text-right font-medium">With extra</th>}
            </tr>
          </thead>
          <tbody>
            {debts.map((d, i) => {
              const b = base.get(d.key) ?? null;
              const p = plan.get(d.key) ?? null;
              const soon = b !== null && b > 0 && b <= 3;
              return (
                <tr key={d.key} className={cn("border-b last:border-0", soon && "bg-success/5")}>
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-2">
                    <a href={d.href ?? "#"} className={cn("font-medium", d.href && "hover:underline")}>{d.name}</a>{" "}
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{d.kind === "CARD" ? "Card" : d.kind === "LOAN" ? "Loan" : "Other"}</Badge>
                    {soon && <Badge variant="success" className="ml-1 px-1.5 py-0 text-[10px]">Closing soon</Badge>}
                    {d.rate ? <span className="ml-1 text-[11px] text-muted-foreground">≈{d.rate.toFixed(1)}% p.a.</span> : null}
                  </td>
                  <td className="tabular px-2 py-2 text-right">{inr(d.balance)}</td>
                  <td className="tabular px-2 py-2 text-right">{d.monthly > 0 ? inr(d.monthly) : <span className="text-muted-foreground">not set</span>}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">{label(month, b)}{b ? <span className="text-xs text-muted-foreground"> · {b} mo</span> : null}</td>
                  {x > 0 && <td className={cn("whitespace-nowrap px-2 py-2 text-right", p !== null && b !== null && p < b && "font-medium text-success")}>{label(month, p)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Based on what you pay each month (the amount due, or this month&apos;s payment) and EMIs left; card interest isn&apos;t included, so card closing dates are the earliest possible. Paying minimum on a card keeps it open much longer.</p>
    </div>
  );
}
