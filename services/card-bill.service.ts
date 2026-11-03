import "server-only";
import type { Prisma } from "@prisma/client";
import { Decimal } from "@/lib/money";

/**
 * A card "bill" is a Statement with a total due — read from an uploaded card statement
 * PDF or typed in on the Debt Tracker. The newest bill also fills the card's own
 * "latest statement" fields (statement date, total / minimum due, due date) so the
 * Credit Cards page, reminders and due alerts use it.
 */
type Tx = Prisma.TransactionClient;

export type CardBillSnapshot = {
  lastStatementDate: string | null;
  currentDueDate: string | null;
  totalAmountDue: string;
  minimumAmountDue: string;
  paidOnBill: string;
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function cardBillSnapshot(tx: Tx, cardId: string): Promise<CardBillSnapshot | null> {
  const c = await tx.creditCard.findUnique({ where: { id: cardId }, select: { lastStatementDate: true, currentDueDate: true, totalAmountDue: true, minimumAmountDue: true, paidOnBill: true } });
  if (!c) return null;
  return { lastStatementDate: day(c.lastStatementDate), currentDueDate: day(c.currentDueDate), totalAmountDue: c.totalAmountDue.toFixed(2), minimumAmountDue: c.minimumAmountDue.toFixed(2), paidOnBill: c.paidOnBill.toFixed(2) };
}

export async function restoreCardBill(tx: Tx, cardId: string, s: CardBillSnapshot) {
  await tx.creditCard.update({
    where: { id: cardId },
    data: {
      lastStatementDate: s.lastStatementDate ? new Date(`${s.lastStatementDate}T00:00:00Z`) : null,
      currentDueDate: s.currentDueDate ? new Date(`${s.currentDueDate}T00:00:00Z`) : null,
      totalAmountDue: new Decimal(s.totalAmountDue),
      minimumAmountDue: new Decimal(s.minimumAmountDue),
      paidOnBill: new Decimal(s.paidOnBill),
    },
  });
}

/** The newest bill on record for the card (deleted statements excluded). */
export function latestBill(tx: Tx, cardId: string) {
  return tx.statement.findFirst({
    where: { creditCardId: cardId, type: "CREDIT_CARD", deletedAt: null, totalDue: { not: null }, statementDate: { not: null } },
    orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }],
  });
}

/**
 * Copy the newest bill onto the card when it's at least as new as what the card shows.
 * `force` copies it even when it's older (used after the newer bill was removed).
 */
export async function syncCardBill(tx: Tx, cardId: string, opts: { force?: boolean } = {}) {
  const [card, bill] = await Promise.all([tx.creditCard.findUnique({ where: { id: cardId }, select: { lastStatementDate: true } }), latestBill(tx, cardId)]);
  if (!card || !bill || !bill.statementDate || !bill.totalDue) return false;
  if (!opts.force && card.lastStatementDate && bill.statementDate < card.lastStatementDate) return false;
  const newBill = !card.lastStatementDate || card.lastStatementDate.getTime() !== bill.statementDate.getTime();
  const total = Decimal.max(bill.totalDue, 0);
  const min = Decimal.min(Decimal.max(bill.minimumDue ?? 0, 0), total);
  await tx.creditCard.update({
    where: { id: cardId },
    data: {
      lastStatementDate: bill.statementDate,
      totalAmountDue: total,
      minimumAmountDue: min,
      currentDueDate: bill.dueDate ?? undefined,
      // "Already paid outside FinSight360" belonged to the previous bill.
      ...(newBill ? { paidOnBill: 0 } : {}),
    },
  });
  return true;
}
