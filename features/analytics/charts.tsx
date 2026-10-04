"use client";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Area } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };
const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;

export function TrendChart({ data }: { data: { label: string; income: number; expenses: number; emi: number; investments: number; savings: number }[] }) {
  if (data.every((d) => !d.income && !d.expenses && !d.emi)) return <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No income or spending recorded in the last 12 months.</p>;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={1}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" {...axis} minTickGap={8} />
          <YAxis width={58} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => inr(Number(v))} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill="var(--chart-income)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--chart-expense)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="emi" name="EMI" fill="var(--chart-3)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="investments" name="Invested" fill="var(--chart-2)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Line type="monotone" dataKey="savings" name="Savings" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeekdayBars({ data }: { data: { day: string; amount: number }[] }) {
  if (data.every((d) => !d.amount)) return <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No spending this month.</p>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" {...axis} />
          <YAxis width={52} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [inr(Number(v)), "Spent"]} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Bar dataKey="amount" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function NetWorthHistory({ data }: { data: { date: string; assets: number; liabilities: number; netWorth: number }[] }) {
  if (data.length < 2) return <p className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">History appears after net worth has been recorded on two different days.</p>;
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="nwh" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" minTickGap={32} {...axis} />
          <YAxis width={60} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [inr(Number(v)), n === "netWorth" ? "Net worth" : n === "assets" ? "Assets" : "Liabilities"]} />
          <Area type="monotone" dataKey="netWorth" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#nwh)" />
          <Line type="monotone" dataKey="liabilities" stroke="var(--chart-expense)" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
