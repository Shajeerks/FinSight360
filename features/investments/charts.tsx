"use client";
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 };
const axis = { tickLine: false, axisLine: false, tick: { fill: "var(--muted-foreground)", fontSize: 12 } } as const;
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--muted-foreground)"];

/** Allocation as one stacked bar + legend list (readable on phones, no pie needed). */
export function AllocationBar({ data }: { data: { label: string; current: number; pct: number }[] }) {
  if (!data.length) return null;
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={data.map((d) => `${d.label} ${d.pct}%`).join(", ")}>
        {data.map((d, i) => <div key={d.label} style={{ width: `${d.pct}%`, background: COLORS[i % COLORS.length] }} />)}
      </div>
      <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{d.label}</span>
            <span className="tabular text-muted-foreground">{inr(d.current)} · {d.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PortfolioHistory({ data }: { data: { date: string; invested: number; current: number }[] }) {
  if (data.length < 2) return <p className="flex h-32 items-center justify-center text-center text-sm text-muted-foreground">The value chart fills in as you check your portfolio on different days.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" minTickGap={32} {...axis} />
          <YAxis width={60} tickFormatter={compactInr} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [inr(Number(v)), n === "current" ? "Value" : "Invested"]} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "current" ? "Value" : "Invested")} />
          <Area type="monotone" dataKey="current" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#pv)" />
          <Area type="monotone" dataKey="invested" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} fill="none" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PriceHistory({ data }: { data: { date: string; price: number }[] }) {
  if (data.length < 2) return <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">Price history appears after a few price updates.</p>;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" minTickGap={32} {...axis} />
          <YAxis width={60} domain={["auto", "auto"]} {...axis} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`₹${Number(v).toLocaleString("en-IN")}`, "Price"]} />
          <Line type="monotone" dataKey="price" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
