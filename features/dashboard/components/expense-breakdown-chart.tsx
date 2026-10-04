"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { inr } from "@/features/dashboard/format-client";

export type BreakdownSlice = { name: string; value: number; color: string };

export function ExpenseBreakdownChart({ data }: { data: BreakdownSlice[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!data.length || total <= 0) {
    return <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">No categorized spending this month.</p>;
  }
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((a, d) => a + d.value, 0);
  const slices = rest > 0 ? [...top, { name: "Others", value: rest, color: "#a1a1aa" }] : top;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={2} stroke="none">
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 }}
              formatter={(v) => inr(Number(v))}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">Spent</span>
          <span className="tabular text-sm font-semibold">{inr(total, 0)}</span>
        </div>
      </div>
      <ul className="grid gap-2 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className="tabular text-muted-foreground">{((s.value / total) * 100).toFixed(0)}%</span>
            <span className="tabular w-24 text-right font-medium">{inr(s.value, 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
