import "server-only";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { openingForTarget } from "@/lib/finance/balances";
import { cardDueInfo, cardUtilization, nextDueDateFromDay, totalUtilization } from "@/lib/finance/credit-card";
import { addDays, todayInTimezone } from "@/lib/dates";
import { Decimal, roundMoney, sum, toDecimal } from "@/lib/money";
import { countableWhere } from "@/lib/transactions/countable";
import { creditCardSchema } from "@/validators/credit-cards";
import { ledgerNet, recomputeCardOutstanding } from "@/services/ledger-balance.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };

export async function getCreditCard(userId: string, id: string) {
  const c = await prisma.creditCard.findFirst({ where: { id, userId, deletedAt: null } });
  if (!c) throw new NotFoundError("Credit card not found.");
  return c;
}

function cardData(data: ReturnType<typeof creditCardSchema.parse>) {
  return {
    bankName: data.bankName,
    cardName: data.cardName,
    network: data.network,
    last4: data.last4,
    creditLimit: roundMoney(data.creditLimit),
    statementDay: data.statementDay,
    paymentDueDay: data.paymentDueDay,
    totalAmountDue: roundMoney(data.totalAmountDue),
    minimumAmountDue: roundMoney(data.minimumAmountDue),
    currentDueDate: data.currentDueDate,
    annualFee: roundMoney(data.annualFee),
    rewardPoints: data.rewardPoints,
    status: data.status,
    notes: data.notes,
  };
}

export async function createCreditCard(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(creditCardSchema, input);
  return prisma.$transaction(async (tx) => {
    const card = await tx.creditCard.create({
      data: { userId, ...cardData(data), openingOutstanding: roundMoney(data.currentOutstanding), currentOutstanding: roundMoney(data.currentOutstanding) },
    });
    await audit({ userId, action: AuditAction.CARD_CREATED, entityType: "CreditCard", entityId: card.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { bank: data.bankName, last4: data.last4 } }, tx);
    return card;
  });
}

export async function updateCreditCard(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(creditCardSchema, input);
  await getCreditCard(userId, id);
  return prisma.$transaction(async (tx) => {
    const net = await ledgerNet(tx, { kind: "card", id, userId });
    await tx.creditCard.update({ where: { id }, data: { ...cardData(data), openingOutstanding: openingForTarget(data.currentOutstanding, net) } });
    await recomputeCardOutstanding(tx, id);
    await audit({ userId, action: AuditAction.CARD_UPDATED, entityType: "CreditCard", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return tx.creditCard.findUniqueOrThrow({ where: { id } });
  });
}

export async function deleteCreditCard(userId: string, id: string, meta: RequestMeta = NO_META) {
  await getCreditCard(userId, id);
  await prisma.$transaction(async (tx) => {
    await tx.creditCard.update({ where: { id }, data: { deletedAt: new Date(), status: "CLOSED" } });
    await audit({ userId, action: AuditAction.CARD_DELETED, entityType: "CreditCard", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

/** Everything the Credit Cards page / dashboard (§17–18) needs, all computed with Decimal. */
export async function getCreditCardOverview(userId: string, timezone = "Asia/Kolkata") {
  const today = todayInTimezone(timezone);
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { cardUtilizationAlertPct: true } });
  const alertPct = toDecimal(profile?.cardUtilizationAlertPct ?? 30);
  const cards = await prisma.creditCard.findMany({ where: { userId, deletedAt: null }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] });

  const rows = await Promise.all(
    cards.map(async (c) => {
      const util = cardUtilization(c.creditLimit, c.currentOutstanding);
      const dueDate = c.currentDueDate ?? (c.paymentDueDay ? nextDueDateFromDay(c.paymentDueDay, today) : null);
      // Payments made this billing cycle reduce what is still due on the statement.
      const cycleStart = c.lastStatementDate ?? (dueDate ? addDays(dueDate, -30) : addDays(today, -30));
      const paid = await prisma.transaction.aggregate({
        where: countableWhere(userId, { creditCardId: c.id, transactionType: "CARD_PAYMENT", transactionDate: { gte: cycleStart } }),
        _sum: { amount: true },
      });
      const paidThisCycle = roundMoney(paid._sum.amount ?? 0);
      const remainingDue = Decimal.max(c.totalAmountDue.minus(paidThisCycle), 0);
      const remainingMinimum = Decimal.max(c.minimumAmountDue.minus(paidThisCycle), 0);
      const due = cardDueInfo({ dueDate, totalAmountDue: remainingDue }, today);
      return { ...c, ...util, due, paidThisCycle, remainingDue, remainingMinimum, aboveAlert: util.utilizationPct.greaterThan(alertPct) };
    }),
  );
  const active = rows.filter((r) => r.status !== "CLOSED");
  const totals = totalUtilization(active.map((c) => ({ creditLimit: c.creditLimit, outstanding: c.currentOutstanding })));
  const horizon = addDays(today, 30);

  return {
    today,
    alertPct,
    cards: rows,
    totals,
    totalDue: roundMoney(sum(active.map((c) => c.remainingDue))),
    upcoming: active
      .filter((c) => c.due.dueDate && c.due.status !== "NO_DUE" && c.due.status !== "OVERDUE" && c.due.dueDate <= horizon)
      .sort((a, b) => a.due.dueDate!.getTime() - b.due.dueDate!.getTime()),
    overdue: active.filter((c) => c.due.status === "OVERDUE"),
  };
}
