import "server-only";
import { z } from "zod";
import type { NotificationChannel, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getMailer } from "@/lib/mail/mailer";
import { currentYearMonth, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getReminderItems, type ReminderItem } from "@/services/reminder.service";
import { getCreditCardOverview } from "@/services/credit-card.service";
import { budgetProgress } from "@/services/budget.service";

/**
 * Notifications: in-app (bell + page), browser (shown by the open app / installed
 * PWA when the user allows it) and email (opt-in). Each alert has a dedupe key so
 * the same thing is never notified twice.
 */

export const NOTIFICATION_TYPES = ["CARD_DUE", "EMI_DUE", "REMINDER", "UTILIZATION_ALERT", "IMPORT", "SECURITY", "SYSTEM"] as const;
export const CHANNELS = ["IN_APP", "BROWSER", "EMAIL"] as const;

export const TYPE_LABEL: Record<(typeof NOTIFICATION_TYPES)[number], string> = {
  CARD_DUE: "Credit-card dues",
  EMI_DUE: "Loan EMIs",
  REMINDER: "Bills, SIPs, insurance & custom reminders",
  UTILIZATION_ALERT: "High card utilization",
  IMPORT: "Imports & email sync",
  SECURITY: "Security (password, sign-ins)",
  SYSTEM: "Budgets & insights",
};

const DEFAULT_LEAD: Record<string, number> = { CARD_DUE: 5, EMI_DUE: 3, REMINDER: 3 };

type Pref = { enabled: boolean; leadDays: number };

/** Effective preferences: IN_APP and BROWSER on, EMAIL off unless the user turned it on. */
export async function getPreferences(userId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const out = {} as Record<(typeof NOTIFICATION_TYPES)[number], Record<(typeof CHANNELS)[number], Pref>>;
  for (const t of NOTIFICATION_TYPES) {
    out[t] = {} as Record<(typeof CHANNELS)[number], Pref>;
    for (const c of CHANNELS) {
      const r = rows.find((x) => x.type === t && x.channel === c);
      out[t][c] = { enabled: r ? r.enabled : c !== "EMAIL", leadDays: r?.leadDays ?? DEFAULT_LEAD[t] ?? 3 };
    }
  }
  return out;
}

export type Preferences = Awaited<ReturnType<typeof getPreferences>>;

const prefsSchema = z.array(
  z.object({ type: z.enum(NOTIFICATION_TYPES), channel: z.enum(CHANNELS), enabled: z.boolean(), leadDays: z.coerce.number().int().min(0).max(30).default(3) }),
).max(NOTIFICATION_TYPES.length * CHANNELS.length);

export async function savePreferences(userId: string, input: unknown) {
  const list = parseOrThrow(prefsSchema, (input as { preferences?: unknown } | null)?.preferences ?? input);
  await prisma.$transaction(
    list.map((p) =>
      prisma.notificationPreference.upsert({
        where: { userId_type_channel: { userId, type: p.type, channel: p.channel } },
        update: { enabled: p.enabled, leadDays: p.leadDays },
        create: { userId, type: p.type, channel: p.channel, enabled: p.enabled, leadDays: p.leadDays },
      }),
    ),
  );
  return getPreferences(userId);
}

type NewNotification = { type: NotificationType; title: string; body: string; link?: string | null; dedupeKey?: string | null; reminderId?: string | null };

async function sendEmail(userId: string, n: NewNotification) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) return;
  try {
    const url = n.link ? `${env().APP_URL}${n.link}` : env().APP_URL;
    await getMailer().send({ to: user.email, subject: `FinSight360: ${n.title}`, text: `${n.body}\n\nOpen FinSight360: ${url}\n\nYou can turn these emails off in Settings → Notifications.` });
    await prisma.notification.createMany({ data: [{ userId, type: n.type, channel: "EMAIL", title: n.title, body: n.body, link: n.link ?? null, dedupeKey: n.dedupeKey ? `${n.dedupeKey}:email` : null, sentAt: new Date(), readAt: new Date() }], skipDuplicates: true });
  } catch (error) {
    logger.error("notification_email_failed", { error, type: n.type });
  }
}

/**
 * Create an in-app notification (once per dedupe key) and, when the user has
 * opted in, the email copy. Returns true when it was new.
 */
export async function notify(userId: string, n: NewNotification, prefs?: Preferences): Promise<boolean> {
  const p = prefs ?? (await getPreferences(userId));
  const t = n.type as (typeof NOTIFICATION_TYPES)[number];
  if (!p[t].IN_APP.enabled && !p[t].EMAIL.enabled && !p[t].BROWSER.enabled) return false;
  const res = await prisma.notification.createMany({
    data: [{ userId, type: n.type, channel: "IN_APP", title: n.title.slice(0, 160), body: n.body.slice(0, 500), link: n.link ?? null, dedupeKey: n.dedupeKey ?? null, reminderId: n.reminderId ?? null, sentAt: new Date(), ...(p[t].IN_APP.enabled ? {} : { readAt: new Date() }) }],
    skipDuplicates: true,
  });
  if (res.count && p[t].EMAIL.enabled) await sendEmail(userId, n);
  return res.count > 0;
}

function dueText(i: ReminderItem) {
  const amt = i.amount && i.amount.greaterThan(0) ? `${formatMoney(i.amount, { decimals: 0 })} ` : "";
  if (i.status === "OVERDUE") return { title: `${i.title} is overdue`, body: `${amt}was due on ${formatDate(i.dueDate)} (${-i.daysLeft} day${i.daysLeft === -1 ? "" : "s"} ago).` };
  if (i.status === "TODAY") return { title: `${i.title} is due today`, body: `${amt}due today, ${formatDate(i.dueDate)}.` };
  return { title: `${i.title} due in ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"}`, body: `${amt}due on ${formatDate(i.dueDate)}.` };
}

/** Turn due/overdue items, high card utilization and budget overruns into notifications. */
export async function generateNotificationsForUser(userId: string) {
  const prefs = await getPreferences(userId);
  let created = 0;
  const items = (await getReminderItems(userId, 60)).filter((i) => i.status !== "COMPLETED");
  for (const i of items) {
    const type: NotificationType = i.source === "CARD" ? "CARD_DUE" : i.source === "EMI" ? "EMI_DUE" : "REMINDER";
    const lead = i.source === "REMINDER" ? i.leadDays : prefs[type as "CARD_DUE"].IN_APP.leadDays;
    const bucket = i.status === "OVERDUE" ? "overdue" : i.status === "TODAY" ? "today" : i.daysLeft <= lead ? "soon" : null;
    if (!bucket) continue;
    const t = dueText(i);
    if (await notify(userId, { type, ...t, link: i.link ?? "/reminders", dedupeKey: `${i.key}:${bucket}`, reminderId: i.source === "REMINDER" ? i.id : null }, prefs)) created++;
  }
  const ym = currentYearMonth();
  const month = `${ym.year}-${String(ym.month).padStart(2, "0")}`;
  const cards = await getCreditCardOverview(userId);
  for (const c of cards.cards) {
    if (c.status === "CLOSED" || !c.aboveAlert) continue;
    if (await notify(userId, { type: "UTILIZATION_ALERT", title: `${c.bankName} ${c.cardName} is ${c.utilizationPct.toFixed(0)}% used`, body: `Outstanding ${formatMoney(c.currentOutstanding, { decimals: 0 })} of a ${formatMoney(c.creditLimit, { decimals: 0 })} limit — above your alert level.`, link: "/credit-cards", dedupeKey: `util:${c.id}:${month}` }, prefs)) created++;
  }
  for (const b of await budgetProgress(userId, ym)) {
    if (b.status === "OK") continue;
    const over = b.status === "OVER";
    if (await notify(userId, { type: "SYSTEM", title: over ? `${b.name} budget exceeded` : `${b.name} budget ${b.usedPct}% used`, body: `${formatMoney(b.spent, { decimals: 0 })} of ${formatMoney(b.amount, { decimals: 0 })} spent this ${b.period === "YEARLY" ? "year" : "month"}.`, link: "/analytics", dedupeKey: `budget:${b.id}:${month}:${b.status}` }, prefs)) created++;
  }
  return { created };
}

// In-memory throttle so opening pages doesn't re-run generation constantly.
const lastRun = new Map<string, number>();
export async function generateIfStale(userId: string, everyMs = 30 * 60_000) {
  const t = lastRun.get(userId) ?? 0;
  if (Date.now() - t < everyMs) return;
  lastRun.set(userId, Date.now());
  try {
    await generateNotificationsForUser(userId);
  } catch (error) {
    logger.error("notification_generation_failed", { error });
  }
}

// ───────────────────────────── inbox ─────────────────────────────

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number; after?: string | null } = {}) {
  const where: Prisma.NotificationWhereInput = { userId, channel: "IN_APP", ...(opts.unreadOnly ? { readAt: null } : {}) };
  return prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: Math.min(opts.limit ?? 100, 200) });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, channel: "IN_APP", readAt: null } });
}

const markSchema = z.object({ ids: z.array(z.string()).max(500).optional(), all: z.boolean().optional() });

export async function markRead(userId: string, input: unknown) {
  const d = parseOrThrow(markSchema, input);
  if (d.ids) assertIds(d.ids);
  const r = await prisma.notification.updateMany({ where: { userId, readAt: null, channel: "IN_APP", ...(d.all ? {} : { id: { in: d.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { updated: r.count };
}

export async function deleteNotification(userId: string, id: string) {
  assertIds(id);
  await prisma.notification.deleteMany({ where: { id, userId } });
}

export type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];
export type ChannelName = NotificationChannel;
