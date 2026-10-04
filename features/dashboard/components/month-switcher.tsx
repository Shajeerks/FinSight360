import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addMonths, formatYearMonth, monthLabel, type YearMonth } from "@/lib/dates";

export function MonthSwitcher({ month, current, basePath = "/dashboard" }: { month: YearMonth; current: YearMonth; basePath?: string }) {
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  const isCurrent = month.year === current.year && month.month === current.month;
  const canGoNext = next.year * 12 + next.month <= current.year * 12 + current.month;
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-card p-1 shadow-xs">
      <Button asChild variant="ghost" size="icon" className="size-9">
        <Link href={`${basePath}?month=${formatYearMonth(prev)}`} aria-label="Previous month" scroll={false}>
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-32 text-center text-sm font-medium">{monthLabel(month)}</span>
      {canGoNext ? (
        <Button asChild variant="ghost" size="icon" className="size-9">
          <Link href={isCurrent ? basePath : `${basePath}?month=${formatYearMonth(next)}`} aria-label="Next month" scroll={false}>
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="size-9" disabled aria-label="Next month">
          <ChevronRight />
        </Button>
      )}
    </div>
  );
}
