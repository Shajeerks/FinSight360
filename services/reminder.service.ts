import "server-only";
import { z } from "zod";
import type { Prisma, ReminderType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { addDays, daysBetween, todayInTimezone } from "@/lib/dates";
import { Decimal, toDecimal } from "@/lib/money";
import { addFrequency, type Frequency } from "@/lib/analytics/recurring";
import { dateSchema, optionalText } from "@/validators/common";
import { getCreditCardOverview } from "@/services/credit-card.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };

/**
 * Reminders = the user's own reminders (insurance, bills, custom…) PLUS items
 * derived live from the ledger: credit-card dues, loan EMIs and confirmed
 * recurring payments (SIPs, subscriptions, rent). Derived items complete
 * themselves when paid; they are never duplicated as stored rows.
 */

export const REMINDER_TYPES = ["CREDIT_CARD_DUE", "LOAN_EMI", "INSURANCE", "SIP", "SUBSCRIPTION", "BILL", "CUSTOM"] as const;
const RECURRENCES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;

export const reminderSchema = z.object({
  type: z.enum(REMINDER_TYPES).default("CUSTOM"),
  title: z.string().trim().min(2, "Give it a short title").max(100),
  description: optionalText(500),
  amount: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => (v === null || v === undefined || v === "" ? null : String(v).replace(/[,₹\s]/g, "")))
    .refine((v) => v === null || /^\d{1,13}(\.\d{1,2})?$/.test(v), "Enter a valid amount"),
  dueDate: dateSchema,
  recurrence: z.union([z.enum(RECURRENCES), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  leadDays: z.coerce.number().int().min(0, "0–60").max(60, "0–60").default(3),
});

export type ReminderItem = {
  key: string;
  source: "REMINDER" | "CARD" | "EMI" | "RECURRING";
  id: string;
  type: ReminderType;
  title: string;
  subtitle: string | null;
  amount: Decimal | null;
  dueDate: Date;
  daysLeft: number;
  status: "OVERDUE" | "TODAY" | "UPCOMING" | "COMPLETED";
  leadDays: number;
  recurrence: string | null;
  link: string | null;
  completedAt: Date | null;
};

const typeForRecurring = (name: string, transactionType: string): ReminderType =>
  transactionType === "INVESTMENT" || /\bSIP\b/i.test(name) ? "SIP" : /insurance|premium|lic\b/i.test(name) ? "INSURANCE" : /netflix|spotify|prime|hotstar|youtube|subscription|icloud/i.test(name) ? "SUBSCRIPTION" : "BILL";

function statusOf(due: Date, today: Date): ReminderItem["status"] {
  const d = daysBetween(today, due);
  return d < 0 ? "OVERDUE" : d === 0 ? "TODAY" : "UPCOMING";
}

async function timezoneOf(userId: string) {
  return (await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } }))?.timezone ?? "Asia/Kolkata";
}

/** Everything due in the next `horizonDays` (plus overdue), and recently completed reminders. */
export async function getReminderItems(userId: string, horizonDays = 45): Promise<ReminderItem[]> {
  const tz = await timezoneOf(userId);
  const today = todayInTimezone(tz);
  const horizon = addDays(today, horizonDays);
  const items: ReminderItem[] = [];

  const [stored, done, cards, emis, recurring] = await Promise.all([
    prisma.reminder.findMany({ where: { userId, deletedAt: null, status: "ACTIVE", dueDate: { lte: horizon } }, orderBy: { dueDate: "asc" } }),
    prisma.reminder.findMany({ where: { userId, deletedAt: null, status: "COMPLETED", completedAt: { gte: addDays(today, -30) } }, orderBy: { completedAt: "desc" }, take: 20 }),
    getCreditCardOverview(userId, tz),
    prisma.loanAmortizationSchedule.findMany({
      where: { loan: { userId, deletedAt: null, status: "ACTIVE" }, status: { in: ["UPCOMING", "PARTIALLY_PAID", "MISSED"] }, dueDate: { lte: horizon } },
      orderBy: { dueDate: "asc" },
      include: { loan: { select: { id: true, name: true, lender: true } }, payments: { where: { deletedAt: null }, select: { amount: true } } },
    }),
    prisma.recurringTransaction.findMany({ where: { userId, status: "CONFIRMED", direction: "DEBIT", nextDueDate: { not: null, lte: horizon }, transactionType: { notIn: ["EMI"] } } }),
  ]);

  for (const r of stored) {
    items.push({ key: `r:${r.id}`, source: "REMINDER", id: r.id, type: r.type, title: r.title, subtitle: r.description, amount: r.amount, dueDate: r.dueDate, daysLeft: daysBetween(today, r.dueDate), status: statusOf(r.dueDate, today), leadDays: r.leadDays, recurrence: r.recurrence, link: null, completedAt: null });
  }
  for (const r of done) {
    items.push({ key: `r:${r.id}`, source: "REMINDER", id: r.id, type: r.type, title: r.title, subtitle: r.description, amount: r.amount, dueDate: r.dueDate, daysLeft: daysBetween(today, r.dueDate), status: "COMPLETED", leadDays: r.leadDays, recurrence: r.recurrence, link: null, completedAt: r.completedAt });
  }
  for (const c of cards.cards) {
    if (c.status === "CLOSED" || !c.due.dueDate || c.remainingDue.lessThanOrEqualTo(0) || c.due.dueDate > horizon) continue;
    items.push({
      key: `card:${c.id}:${c.due.dueDate.toISOString().slice(0, 10)}`, source: "CARD", id: c.id, type: "CREDIT_CARD_DUE",
      title: `${c.bankName} ${c.cardName} ••${c.last4} bill`, subtitle: c.remainingMinimum.greaterThan(0) ? `Minimum ₹${c.remainingMinimum.toFixed(0)}` : null,
      amount: c.remainingDue, dueDate: c.due.dueDate, daysLeft: daysBetween(today, c.due.dueDate), status: statusOf(c.due.dueDate, today), leadDays: 5, recurrence: "MONTHLY", link: "/credit-cards", completedAt: null,
    });
  }
  for (const e of emis) {
    const paid = e.payments.reduce((a, p) => a.plus(p.amount), new Decimal(0));
    items.push({
      key: `emi:${e.id}`, source: "EMI", id: e.loan.id, type: "LOAN_EMI", title: `${e.loan.name} EMI #${e.installmentNumber}`, subtitle: e.loan.lender,
      amount: Decimal.max(e.emiAmount.minus(paid), 0), dueDate: e.dueDate, daysLeft: daysBetween(today, e.dueDate), status: statusOf(e.dueDate, today), leadDays: 3, recurrence: "MONTHLY", link: `/loans/${e.loan.id}`, completedAt: null,
    });
  }
  for (const r of recurring) {
    // Already paid this cycle? (a matching ledger row on/after the due date's window)
    const due = r.nextDueDate!;
    items.push({
      key: `rec:${r.id}:${due.toISOString().slice(0, 10)}`, source: "RECURRING", id: r.id, type: typeForRecurring(r.name, r.transactionType), title: r.name, subtitle: "Recurring payment",
      amount: r.expectedAmount, dueDate: due, daysLeft: daysBetween(today, due), status: statusOf(due, today), leadDays: 2, recurrence: r.frequency, link: "/analytics", completedAt: null,
    });
  }
  const order = { OVERDUE: 0, TODAY: 1, UPCOMING: 2, COMPLETED: 3 };
  return items.sort((a, b) => order[a.status] - order[b.status] || a.dueDate.getTime() - b.dueDate.getTime());
}

export async function saveReminder(userId: string, id: string | null, input: unknown, meta: RequestMeta = NO_META) {
  assertIds(id);
  const d = parseOrThrow(reminderSchema, input);
  if (d.type === "CREDIT_CARD_DUE" || d.type === "LOAN_EMI") {
    throw new AppError("Card dues and loan EMIs are reminded automatically from your cards and loans.", 400, "AUTO_REMINDER", { type: ["Choose another type"] });
  }
  const data = { type: d.type, title: d.title, description: d.description, amount: d.amount === null ? null : toDecimal(d.amount), dueDate: d.dueDate, recurrence: d.recurrence, leadDays: d.leadDays };
  let r;
  if (id) {
    const existing = await prisma.reminder.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) throw new NotFoundError("Reminder not found.");
    r = await prisma.reminder.update({ where: { id }, data });
  } else {
    r = await prisma.reminder.create({ data: { userId, ...data } });
  }
  await audit({ userId, action: id ? "reminder.updated" : "reminder.created", entityType: "Reminder", entityId: r.id, ip: meta.ip, userAgent: meta.userAgent });
  return r;
}

/** Mark done. A repeating reminder rolls forward to its next date. A recurring payment moves to its next cycle. */
export async function completeReminder(userId: string, key: string, meta: RequestMeta = NO_META) {
  const [kind, id] = key.split(":");
  assertIds(id);
  if (kind === "r") {
    return prisma.$transaction(async (tx) => {
      const r = await tx.reminder.findFirst({ where: { id, userId, deletedAt: null, status: "ACTIVE" } });
      if (!r) throw new NotFoundError("Reminder not found.");
      await tx.reminder.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      let next = null;
      if (r.recurrence) {
        const d = r.recurrence === "DAILY" ? addDays(r.dueDate, 1) : addFrequency(r.dueDate, r.recurrence as Frequency, r.dueDate.getUTCDate());
        next = await tx.reminder.create({ data: { userId, type: r.type, title: r.title, description: r.description, amount: r.amount, dueDate: d, recurrence: r.recurrence, leadDays: r.leadDays, creditCardId: r.creditCardId, loanId: r.loanId, recurringTransactionId: r.recurringTransactionId } });
      }
      // Its notifications are no longer relevant.
      await tx.notification.updateMany({ where: { userId, reminderId: id, readAt: null }, data: { readAt: new Date() } });
      await audit({ userId, action: "reminder.completed", entityType: "Reminder", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
      return { next: next?.dueDate ?? null };
    });
  }
  if (kind === "rec") {
    const r = await prisma.recurringTransaction.findFirst({ where: { id, userId, status: "CONFIRMED" } });
    if (!r || !r.nextDueDate) throw new NotFoundError("Recurring payment not found.");
    const next = addFrequency(r.nextDueDate, r.frequency as Frequency, r.dayOfMonth);
    await prisma.recurringTransaction.update({ where: { id }, data: { nextDueDate: next, lastSeenDate: r.nextDueDate } });
    await audit({ userId, action: "recurring.marked_paid", entityType: "RecurringTransaction", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { next };
  }
  throw new AppError("Card dues and EMIs complete automatically when you record the payment.", 400, "AUTO_REMINDER");
}

export async function deleteReminder(userId: string, id: string, meta: RequestMeta = NO_META) {
  assertIds(id);
  const r = await prisma.reminder.findFirst({ where: { id, userId, deletedAt: null } });
  if (!r) throw new NotFoundError("Reminder not found.");
  await prisma.reminder.update({ where: { id }, data: { deletedAt: new Date(), status: "CANCELLED" } });
  await audit({ userId, action: "reminder.deleted", entityType: "Reminder", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

export async function getReminder(userId: string, id: string) {
  assertIds(id);
  const r = await prisma.reminder.findFirst({ where: { id, userId, deletedAt: null } });
  if (!r) throw new NotFoundError("Reminder not found.");
  return r;
}

/** Daily job (all users): turn due/overdue items into notifications (+ email when enabled). */
export async function dailyDueRunForAllUsers() {
  const { generateNotificationsForUser } = await import("@/services/notification.service");
  const users = await prisma.user.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true } });
  let created = 0;
  for (const u of users) created += (await generateNotificationsForUser(u.id)).created;
  return { users: users.length, notifications: created };
}

export type ReminderTx = Prisma.TransactionClient;
