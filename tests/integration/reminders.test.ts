import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { addDays, todayInTimezone } from "@/lib/dates";
import { setMailer, type MailMessage } from "@/lib/mail/mailer";
import { createCreditCard } from "@/services/credit-card.service";
import { createLoan } from "@/services/loan.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { completeReminder, deleteReminder, getReminderItems, saveReminder } from "@/services/reminder.service";
import { generateNotificationsForUser, getPreferences, listNotifications, markRead, notify, savePreferences, unreadCount } from "@/services/notification.service";
import { revokeAllSessions } from "@/services/auth.service";
import { meta, resetDatabase } from "./helpers";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("Phase 8 reminders & notifications (integration)", () => {
  let userId: string;
  let today: Date;
  const sent: MailMessage[] = [];

  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "rem@example.com", name: "Rem" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    today = todayInTimezone("Asia/Kolkata");
    sent.length = 0;
    setMailer({ send: async (m) => void sent.push(m) });
  });
  afterEach(() => setMailer(null));
  afterAll(() => prisma.$disconnect());

  it("lists stored reminders with statuses and rejects automatic types", async () => {
    await saveReminder(userId, null, { type: "INSURANCE", title: "Health premium", amount: "24,500", dueDate: iso(addDays(today, 2)), recurrence: "YEARLY", leadDays: 5 }, meta);
    await saveReminder(userId, null, { type: "BILL", title: "Electricity", dueDate: iso(addDays(today, -1)) }, meta);
    await saveReminder(userId, null, { type: "CUSTOM", title: "Far away", dueDate: iso(addDays(today, 200)) }, meta);
    const items = await getReminderItems(userId);
    expect(items.map((i) => [i.title, i.status])).toEqual([
      ["Electricity", "OVERDUE"],
      ["Health premium", "UPCOMING"],
    ]);
    expect(items[1].amount?.toString()).toBe("24500");
    await expect(saveReminder(userId, null, { type: "LOAN_EMI", title: "EMI", dueDate: iso(today) }, meta)).rejects.toMatchObject({ code: "AUTO_REMINDER" });
    await expect(saveReminder(userId, null, { type: "BILL", title: "x", dueDate: iso(today), amount: "abc" }, meta)).rejects.toBeTruthy();
  });

  it("completing a repeating reminder rolls it forward; delete hides it; other users can't touch it", async () => {
    const r = await saveReminder(userId, null, { type: "SUBSCRIPTION", title: "Gym", dueDate: iso(today), recurrence: "MONTHLY" }, meta);
    const res = await completeReminder(userId, `r:${r.id}`, meta);
    expect(res.next).not.toBeNull();
    const items = await getReminderItems(userId);
    expect(items.filter((i) => i.title === "Gym").map((i) => i.status).sort()).toEqual(["COMPLETED", "UPCOMING"]);
    await expect(completeReminder(userId, `r:${r.id}`, meta)).rejects.toMatchObject({ status: 404 });

    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    const next = items.find((i) => i.title === "Gym" && i.status === "UPCOMING")!;
    await expect(deleteReminder(other, next.id, meta)).rejects.toMatchObject({ status: 404 });
    await expect(completeReminder(other, `r:${next.id}`, meta)).rejects.toMatchObject({ status: 404 });
    await deleteReminder(userId, next.id, meta);
    expect((await getReminderItems(userId)).filter((i) => i.status !== "COMPLETED")).toHaveLength(0);
    await expect(completeReminder(userId, "r:bad id!", meta)).rejects.toBeTruthy();
  });

  it("derives card dues and EMIs, and turns them into notifications only once", async () => {
    await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "100000", currentOutstanding: "92000", totalAmountDue: "15000", minimumAmountDue: "750", currentDueDate: iso(addDays(today, 3)) }, meta);
    const first = addDays(today, 2);
    await createLoan(userId, { name: "Car loan", lender: "HDFC Bank", loanType: "CAR", principal: "500000", interestRate: "9", tenureMonths: 24, startDate: iso(addDays(first, -30)), firstEmiDate: iso(first) }, meta);
    const items = await getReminderItems(userId);
    expect(items.some((i) => i.source === "CARD" && i.amount?.toString() === "15000")).toBe(true);
    expect(items.some((i) => i.source === "EMI" && i.daysLeft === 2)).toBe(true);

    const r1 = await generateNotificationsForUser(userId);
    // card due (within 5 days), EMI due (within 3 days), utilization 92% alert
    expect(r1.created).toBe(3);
    const r2 = await generateNotificationsForUser(userId);
    expect(r2.created).toBe(0);
    expect(await unreadCount(userId)).toBe(3);
    const list = await listNotifications(userId);
    expect(list.map((n) => n.type).sort()).toEqual(["CARD_DUE", "EMI_DUE", "UTILIZATION_ALERT"]);
    expect(sent).toHaveLength(0); // email is opt-in

    await markRead(userId, { ids: [list[0].id] });
    expect(await unreadCount(userId)).toBe(2);
    await markRead(userId, { all: true });
    expect(await unreadCount(userId)).toBe(0);
  });

  it("respects preferences: lead days, disabled types and opt-in email", async () => {
    const prefs = await getPreferences(userId);
    expect(prefs.CARD_DUE.EMAIL.enabled).toBe(false);
    expect(prefs.CARD_DUE.IN_APP.enabled).toBe(true);
    await createCreditCard(userId, { bankName: "SBI", cardName: "Elite", last4: "2211", creditLimit: "200000", currentOutstanding: "10000", totalAmountDue: "10000", currentDueDate: iso(addDays(today, 8)) }, meta);
    expect((await generateNotificationsForUser(userId)).created).toBe(0); // 8 days > default 5

    await savePreferences(userId, {
      preferences: [
        { type: "CARD_DUE", channel: "IN_APP", enabled: true, leadDays: 10 },
        { type: "CARD_DUE", channel: "EMAIL", enabled: true, leadDays: 10 },
      ],
    });
    expect((await generateNotificationsForUser(userId)).created).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("rem@example.com");
    expect(sent[0].subject).toContain("SBI Elite");
    // No second email on the next run.
    await generateNotificationsForUser(userId);
    expect(sent).toHaveLength(1);

    await expect(savePreferences(userId, { preferences: [{ type: "CARD_DUE", channel: "SMS", enabled: true }] })).rejects.toBeTruthy();
    await expect(savePreferences(userId, { preferences: [{ type: "CARD_DUE", channel: "IN_APP", enabled: true, leadDays: 99 }] })).rejects.toBeTruthy();

    // A fully disabled type is not created at all.
    await savePreferences(userId, { preferences: (["IN_APP", "BROWSER", "EMAIL"] as const).map((channel) => ({ type: "SYSTEM", channel, enabled: false })) });
    expect(await notify(userId, { type: "SYSTEM", title: "x", body: "y", dedupeKey: "sys:1" })).toBe(false);
  });

  it("dedupes by key per user and records security notices", async () => {
    expect(await notify(userId, { type: "SYSTEM", title: "Hello", body: "b", dedupeKey: "k1" })).toBe(true);
    expect(await notify(userId, { type: "SYSTEM", title: "Hello", body: "b", dedupeKey: "k1" })).toBe(false);
    const other = (await prisma.user.create({ data: { email: "o2@example.com" } })).id;
    expect(await notify(other, { type: "SYSTEM", title: "Hello", body: "b", dedupeKey: "k1" })).toBe(true);
    await revokeAllSessions(userId, meta);
    const sec = (await listNotifications(userId)).filter((n) => n.type === "SECURITY");
    expect(sec).toHaveLength(1);
    expect(sec[0].title).toBe("Signed out everywhere");
    // Users only see their own notifications.
    expect((await listNotifications(other)).every((n) => n.userId === other)).toBe(true);
  });
});
