import Link from "next/link";
import { BellRing, CalendarClock, CreditCard, HandCoins } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { UpcomingPayment } from "@/services/dashboard.service";

const ICON = { CARD: CreditCard, EMI: HandCoins, REMINDER: BellRing } as const;

function statusBadge(p: UpcomingPayment) {
  if (p.status === "OVERDUE") return <Badge variant="destructive">Overdue {Math.abs(p.daysRemaining)}d</Badge>;
  if (p.status === "DUE_TODAY") return <Badge variant="warning">Due today</Badge>;
  if (p.status === "DUE_SOON") return <Badge variant="warning">In {p.daysRemaining}d</Badge>;
  return <Badge variant="secondary">In {p.daysRemaining}d</Badge>;
}

export function UpcomingPayments({ items }: { items: UpcomingPayment[] }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <CalendarClock className="size-8 text-muted-foreground/60" />
        Nothing due in the next 30 days.
        <Link href="/reminders" className="text-primary hover:underline">Add a reminder</Link>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {items.map((p) => {
        const Icon = ICON[p.kind];
        return (
          <li key={p.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{p.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {p.subtitle} · {formatDate(p.dueDate)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="tabular text-sm font-semibold">{p.amount ? formatMoney(p.amount, { decimals: 0 }) : "—"}</span>
              {statusBadge(p)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
