"use client";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };
const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;

export type TrendPoint = { label: string; closing: number; interest: number; principal: number };

/** Total debt (area, left axis) with what each month's payments did: principal repaid vs interest (bars, right axis). */
export function DebtTrendChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  if (!data.some((d) => d.closing || d.interest || d.principal)) {
    return <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">Nothing to chart yet.</p>;
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="debt-out" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" minTickGap={16} {...axis} />
          <YAxis yAxisId="out" width={60} tickFormatter={compactInr} {...axis} />
          <YAxis yAxisId="pay" orientation="right" width={52} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [inr(Number(v), 0), String(name)]} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Area yAxisId="out" type="monotone" dataKey="closing" name="Total outstanding" stroke="var(--chart-2)" strokeWidth={2.5} fill="url(#debt-out)" />
          <Bar yAxisId="pay" dataKey="principal" name="Principal repaid" stackId="p" fill="var(--chart-1)" maxBarSize={28} />
          <Bar yAxisId="pay" dataKey="interest" name="Interest & charges" stackId="p" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
