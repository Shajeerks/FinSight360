"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactInr, inr } from "@/features/dashboard/format-client";

export type IncomeExpensePoint = { label: string; income: number; expenses: number; emi: number };

export function IncomeExpenseChart({ data }: { data: IncomeExpensePoint[] }) {
  const empty = data.every((d) => d.income === 0 && d.expenses === 0 && d.emi === 0);
  if (empty) return <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">No income or expenses recorded in the last 6 months.</p>;
  return (
    <div className="h-64 w-full sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={compactInr} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
            formatter={(v) => inr(Number(v))}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill="var(--chart-income)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="expenses" name="Expenses" fill="var(--chart-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="emi" name="EMI" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
