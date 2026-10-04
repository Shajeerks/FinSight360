"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

export type NetWorthPoint = { label: string; value: number };

export function NetWorthChart({ data }: { data: NetWorthPoint[] }) {
  if (data.length < 2) {
    return (
      <p className="flex h-56 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        The trend appears once net worth has been recorded in two different months. A snapshot is saved every day while FinSight360 runs.
      </p>
    );
  }
  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} width={60} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={compactInr} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
            formatter={(v) => [inr(Number(v), 0), "Net worth"]}
          />
          <Area type="monotone" dataKey="value" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#nw)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
