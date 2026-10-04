"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };
const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;

export function PrincipalInterestBars({ data, height = 260 }: { data: { label: string; principal: number; interest: number }[]; height?: number }) {
  if (!data.some((d) => d.principal || d.interest)) return <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No loan payments recorded yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" {...axis} />
          <YAxis width={56} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => inr(Number(v))} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="principal" name="Principal" stackId="a" fill="var(--chart-1)" maxBarSize={36} />
          <Bar dataKey="interest" name="Interest" stackId="a" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceCurve({ data }: { data: { label: string; balance: number }[] }) {
  if (data.length < 2) return null;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" minTickGap={28} {...axis} />
          <YAxis width={60} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [inr(Number(v)), "Outstanding"]} />
          <Area type="monotone" dataKey="balance" stroke="var(--chart-2)" strokeWidth={2.5} fill="url(#bal)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
