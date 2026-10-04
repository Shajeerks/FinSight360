import { AlertTriangle, Info, Sparkles, TrendingUp } from "lucide-react";
import type { Insight } from "@/services/dashboard.service";
import { cn } from "@/lib/utils";

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  if (!insights.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <Sparkles className="size-8 text-muted-foreground/60" />
        Insights appear as soon as there is enough data.
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {insights.map((i) => {
        const Icon = i.tone === "warning" ? AlertTriangle : i.tone === "positive" ? TrendingUp : Info;
        return (
          <li key={i.id} className="flex gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <Icon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                i.tone === "warning" && "text-amber-600 dark:text-warning",
                i.tone === "positive" && "text-success",
                i.tone === "neutral" && "text-primary",
              )}
            />
            <span>{i.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
