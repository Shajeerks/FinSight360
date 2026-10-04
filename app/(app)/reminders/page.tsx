import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, CalendarCheck, CalendarClock, CircleAlert, Clock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { getReminderItems, type ReminderItem } from "@/services/reminder.service";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { ReminderDialog, ReminderItemActions, REMINDER_TYPE_LABEL } from "@/features/reminders/reminder-components";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reminders" };

const GROUPS: { status: ReminderItem["status"]; title: string; icon: typeof Clock }[] = [
  { status: "OVERDUE", title: "Overdue", icon: CircleAlert },
  { status: "TODAY", title: "Due today", icon: Clock },
  { status: "UPCOMING", title: "Upcoming (next 45 days)", icon: CalendarClock },
  { status: "COMPLETED", title: "Completed (last 30 days)", icon: CalendarCheck },
];

function when(i: ReminderItem) {
  if (i.status === "COMPLETED") return `Done ${i.completedAt ? formatDate(i.completedAt) : ""}`;
  if (i.status === "OVERDUE") return `${-i.daysLeft} day${i.daysLeft === -1 ? "" : "s"} overdue · was due ${formatDate(i.dueDate)}`;
  if (i.status === "TODAY") return "Due today";
  return `In ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"} · ${formatDate(i.dueDate)}`;
}

export default async function RemindersPage() {
  const user = await requireUser();
  const items = await getReminderItems(user.id);
  const storedIds = items.filter((i) => i.source === "REMINDER").map((i) => i.id);
  const stored = new Map((await prisma.reminder.findMany({ where: { id: { in: storedIds }, userId: user.id } })).map((r) => [r.id, r]));
  const open = items.filter((i) => i.status !== "COMPLETED");
  const dueSoon = open.filter((i) => i.daysLeft <= 7);
  const dueSoonTotal = dueSoon.reduce((a, i) => (i.amount ? a + i.amount.toNumber() : a), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Reminders" description="Card dues, loan EMIs, SIPs, subscriptions, insurance and your own reminders — all in one list." actions={<ReminderDialog />} />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Reminder summary">
        <StatCard title="Overdue" value={String(open.filter((i) => i.status === "OVERDUE").length)} icon={CircleAlert} tone={open.some((i) => i.status === "OVERDUE") ? "danger" : "default"} />
        <StatCard title="Due today" value={String(open.filter((i) => i.status === "TODAY").length)} icon={Clock} />
        <StatCard title="Next 7 days" value={String(dueSoon.length)} icon={CalendarClock} sub={dueSoonTotal ? `${formatMoney(dueSoonTotal, { decimals: 0 })} to pay` : undefined} />
        <StatCard title="Next 45 days" value={String(open.length)} icon={BellRing} tone="primary" />
      </section>

      {items.length === 0 ? (
        <EmptyState icon={BellRing} title="Nothing due" description="Add a credit card or loan and its dues appear here automatically, or add your own reminder." action={<ReminderDialog />} />
      ) : (
        GROUPS.map((g) => {
          const list = items.filter((i) => i.status === g.status);
          if (!list.length) return null;
          return (
            <Card key={g.status}>
              <CardHeader>
                <CardTitle className={cn("flex items-center gap-2 text-base", g.status === "OVERDUE" && "text-destructive")}><g.icon className="size-4" /> {g.title} <Badge variant="secondary">{list.length}</Badge></CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {list.map((i) => {
                    const r = i.source === "REMINDER" ? stored.get(i.id) : undefined;
                    return (
                      <li key={i.key} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center", i.status === "COMPLETED" && "opacity-70")}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {i.link ? <Link href={i.link} className="truncate font-medium hover:underline">{i.title}</Link> : <span className="truncate font-medium">{i.title}</span>}
                            <Badge variant="secondary">{REMINDER_TYPE_LABEL[i.type]}</Badge>
                            {i.source !== "REMINDER" && <Badge variant="outline">Automatic</Badge>}
                          </div>
                          <p className={cn("text-xs", i.status === "OVERDUE" ? "text-destructive" : "text-muted-foreground")}>
                            {when(i)}{i.subtitle ? ` · ${i.subtitle}` : ""}{i.recurrence && i.source === "REMINDER" ? ` · repeats ${i.recurrence.toLowerCase().replace("_", "-")}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          {i.amount && <span className="tabular whitespace-nowrap font-semibold">{formatMoney(i.amount, { decimals: 0 })}</span>}
                          {i.status !== "COMPLETED" && (
                            <ReminderItemActions
                              itemKey={i.key}
                              source={i.source}
                              reminder={r ? { id: r.id, type: r.type, title: r.title, description: r.description ?? "", amount: r.amount?.toString() ?? "", dueDate: r.dueDate.toISOString().slice(0, 10), recurrence: r.recurrence ?? "", leadDays: String(r.leadDays) } : undefined}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}
      <p className="text-xs text-muted-foreground">Card bills and EMIs clear themselves when you record the payment. Choose how you&apos;re notified in <Link href="/notifications" className="underline underline-offset-2">Notifications</Link>.</p>
    </div>
  );
}
