import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Trend = { pct: number; goodWhen: "up" | "down"; label?: string } | null;

export function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  trend,
  tone = "default",
  className,
}: {
  title: string;
  value: string;
  sub?: React.ReactNode;
  icon: LucideIcon;
  trend?: Trend;
  tone?: "default" | "primary" | "danger";
  className?: string;
}) {
  const up = trend ? trend.pct >= 0 : false;
  const good = trend ? (trend.goodWhen === "up" ? up : !up) : false;
  return (
    <Card className={cn("relative overflow-hidden", tone === "primary" && "border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card", className)}>
      <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{title}</p>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
              tone === "primary" && "bg-primary/15 text-primary",
              tone === "danger" && "bg-destructive/10 text-destructive",
            )}
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="tabular truncate text-lg font-semibold tracking-tight sm:text-2xl" title={value}>
          {value}
        </p>
        <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {trend && Number.isFinite(trend.pct) && (
            <span className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-success" : "text-destructive")}>
              {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(trend.pct).toFixed(1)}%
            </span>
          )}
          {trend?.label && <span>{trend.label}</span>}
          {sub && <span className="truncate">{sub}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
