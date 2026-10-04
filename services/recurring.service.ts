import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { countableWhere } from "@/lib/transactions/countable";
import { normalizeDescription } from "@/lib/transactions/normalize";
import { detectRecurring, monthlyEquivalent, type Frequency } from "@/lib/analytics/recurring";
import { Decimal, roundMoney, toDecimal } from "@/lib/money";
import { positiveMoney } from "@/validators/common";

const NO_META: RequestMeta = { ip: null, userAgent: null };

/**
 * Finds recurring payments/income in the last 13 months of the ledger and
 * records them as DETECTED commitments. The user confirms, pauses or dismisses
 * them; dismissed ones are never re-suggested.
 */
export async function detectRecurringForUser(userId: string) {
  const since = new Date(Date.now() - 400 * 86_400_000);
  const txns = await prisma.transaction.findMany({
    where: countableWhere(userId, {
      transactionDate: { gte: since },
      transferGroupId: null,
      OR: [
        { direction: "DEBIT", transactionType: { in: ["EXPENSE", "EMI", "INVESTMENT", "FEE", "OTHER"] } },
        { direction: "CREDIT", transactionType: { in: ["INCOME", "INTEREST"] } },
      ],
    }),
    select: { id: true, transactionDate: true, amount: true, direction: true, transactionType: true, merchantId: true, merchantName: true, description: true, categoryId: true, subCategoryId: true, bankAccountId: true, creditCardId: true },
  });
  const keyOf = (t: (typeof txns)[number]) => (t.merchantId ? `m:${t.merchantId}` : `d:${normalizeDescription(t.description).split(" ").slice(0, 3).join(" ")}`);
  const series = detectRecurring(txns.map((t) => ({ key: keyOf(t), name: t.merchantName ?? t.description.slice(0, 60), transactionDate: t.transactionDate, amount: t.amount, direction: t.direction })));
  const existing = await prisma.recurringTransaction.findMany({ where: { userId } });
  let created = 0;
  let updated = 0;
  for (const s of series) {
    const members = txns.filter((t) => keyOf(t) === s.key && t.direction === s.direction);
    const latest = members.sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime())[0];
    const merchantId = s.key.startsWith("m:") ? s.key.slice(2) : null;
    const match = existing.find(
      (e) => e.direction === s.direction && (merchantId ? e.merchantId === merchantId : !e.merchantId && normalizeDescription(e.name) === normalizeDescription(s.name)) && e.frequency === s.frequency,
    ) ?? existing.find((e) => merchantId && e.merchantId === merchantId && e.direction === s.direction && toDecimal(e.expectedAmount).minus(s.expectedAmount).abs().lessThanOrEqualTo(toDecimal(e.expectedAmount).times(0.2)));
    const data = {
      expectedAmount: s.expectedAmount,
      frequency: s.frequency,
      dayOfMonth: s.dayOfMonth,
      lastSeenDate: s.lastSeen,
      nextDueDate: s.nextDue,
      occurrenceCount: s.occurrences,
      detectionConfidence: s.confidence,
    };
    if (match) {
      if (match.status === "DISMISSED") continue;
      // Confirmed commitments keep the user's own amount/name; only "last seen" facts update.
      await prisma.recurringTransaction.update({
        where: { id: match.id },
        data: match.status === "CONFIRMED" ? { lastSeenDate: s.lastSeen, nextDueDate: s.nextDue, occurrenceCount: s.occurrences, detectionConfidence: s.confidence } : data,
      });
      await prisma.transaction.updateMany({ where: { id: { in: members.map((m) => m.id) }, recurringTransactionId: null }, data: { recurringTransactionId: match.id } });
      updated++;
    } else {
      const r = await prisma.recurringTransaction.create({
        data: {
          userId, name: s.name.slice(0, 80), merchantId, direction: s.direction, transactionType: latest.transactionType,
          categoryId: latest.categoryId, subCategoryId: latest.subCategoryId, bankAccountId: latest.bankAccountId, creditCardId: latest.creditCardId,
          status: "DETECTED", ...data,
        },
      });
      await prisma.transaction.updateMany({ where: { id: { in: members.map((m) => m.id) }, recurringTransactionId: null }, data: { recurringTransactionId: r.id } });
      created++;
    }
  }
  return { created, updated, series: series.length };
}

export async function listRecurring(userId: string) {
  const rows = await prisma.recurringTransaction.findMany({
    where: { userId, status: { not: "DISMISSED" } },
    orderBy: [{ status: "asc" }, { expectedAmount: "desc" }],
    include: { category: { select: { name: true, color: true } }, bankAccount: { select: { nickname: true } }, creditCard: { select: { cardName: true, last4: true } } },
  });
  const active = rows.filter((r) => r.status === "CONFIRMED");
  const monthlyOut = active.filter((r) => r.direction === "DEBIT").reduce((a, r) => a.plus(monthlyEquivalent(r.expectedAmount, r.frequency as Frequency)), new Decimal(0));
  const monthlyIn = active.filter((r) => r.direction === "CREDIT").reduce((a, r) => a.plus(monthlyEquivalent(r.expectedAmount, r.frequency as Frequency)), new Decimal(0));
  return { rows, monthlyOut: roundMoney(monthlyOut), monthlyIn: roundMoney(monthlyIn) };
}

export type RecurringList = Awaited<ReturnType<typeof listRecurring>>;

const recurringUpdateSchema = z.object({
  status: z.enum(["CONFIRMED", "DISMISSED", "PAUSED"]).optional(),
  name: z.string().trim().min(2).max(80).optional(),
  expectedAmount: positiveMoney.optional(),
});

export async function updateRecurring(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  assertIds(id);
  const d = parseOrThrow(recurringUpdateSchema, input);
  const r = await prisma.recurringTransaction.findFirst({ where: { id, userId } });
  if (!r) throw new NotFoundError("Recurring item not found.");
  if (!Object.keys(d).length) throw new AppError("Nothing to change.", 400, "NO_CHANGE");
  const data: Prisma.RecurringTransactionUpdateInput = {};
  if (d.status) data.status = d.status;
  if (d.name) data.name = d.name;
  if (d.expectedAmount) data.expectedAmount = toDecimal(d.expectedAmount);
  const u = await prisma.recurringTransaction.update({ where: { id }, data });
  if (d.status === "DISMISSED") await prisma.transaction.updateMany({ where: { recurringTransactionId: id }, data: { recurringTransactionId: null } });
  await audit({ userId, action: "recurring.updated", entityType: "RecurringTransaction", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { status: d.status ?? null } });
  return u;
}
