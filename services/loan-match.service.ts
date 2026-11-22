import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { toDecimal } from "@/lib/money";
import type { RequestMeta } from "@/lib/security/request";
import { countableWhere } from "@/lib/transactions/countable";
import { bestLoanMatch, type LoanForMatch } from "@/lib/finance/loan-match";
import { recordLoanPayment } from "@/services/loan.service";
import { LOAN_PAYMENT_TYPES } from "@/validators/loans";

/**
 * Linking bank debits to loans: finds payments in your bank statements that look like
 * EMIs, links the clear ones automatically after a statement is imported, and lets you
 * link any debit to a loan and instalment by hand. A link uses the existing transaction
 * (its date and amount) — nothing new is added to the ledger, so balances don't change.
 */

const NO_META: RequestMeta = { ip: null, userAgent: null };
const DAY = 86_400_000;
const UNPAID = ["UPCOMING", "PARTIALLY_PAID", "MISSED"] as const;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const linkLoanPaymentSchema = z.object({
  transactionId: idSchema,
  loanId: idSchema,
  scheduleId: idSchema.optional().nullable().or(z.literal("")).transform((v) => v || undefined),
  paymentType: z.enum(LOAN_PAYMENT_TYPES).default("EMI"),
});

async function activeLoans(userId: string, loanId?: string) {
  return prisma.loan.findMany({
    where: { userId, deletedAt: null, status: "ACTIVE", ...(loanId ? { id: loanId } : {}) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, lender: true, accountLast4: true, emiAmount: true, firstEmiDate: true, outstandingPrincipal: true,
      schedule: { where: { status: { in: [...UNPAID] } }, orderBy: { installmentNumber: "asc" }, select: { id: true, installmentNumber: true, dueDate: true, emiAmount: true, status: true } },
      payments: { where: { deletedAt: null, isOpening: false }, select: { paymentDate: true, amount: true } },
    },
  });
}

/** Loans and their unpaid instalments, for the "Link to loan" choosers. */
export async function getLoanLinkOptions(userId: string) {
  const loans = await activeLoans(userId);
  return loans.map((l) => ({
    id: l.id,
    label: l.lender === l.name ? l.name : `${l.lender} — ${l.name}`,
    emi: toDecimal(l.emiAmount).toFixed(2),
    instalments: l.schedule.slice(0, 24).map((r) => ({
      id: r.id,
      label: `EMI #${r.installmentNumber} · due ${r.dueDate.toISOString().slice(0, 10)} · ₹${toDecimal(r.emiAmount).toFixed(0)}${r.status === "PARTIALLY_PAID" ? " · part paid" : r.status === "MISSED" ? " · overdue" : ""}`,
      dueDate: r.dueDate.toISOString().slice(0, 10),
    })),
  }));
}
export type LoanLinkOption = Awaited<ReturnType<typeof getLoanLinkOptions>>[number];

/** Bank / cash debits that can still become a loan payment. */
function linkableWhere(userId: string, since: Date) {
  return countableWhere(userId, {
    direction: "DEBIT",
    OR: [{ bankAccountId: { not: null } }, { cashAccountId: { not: null } }],
    creditCardId: null,
    transferGroupId: null,
    transactionType: { in: ["EMI", "EXPENSE", "OTHER", "TRANSFER", "FEE"] },
    loanPayment: { is: null },
    transactionDate: { gte: since },
  });
}

/**
 * Debits that look like payments of your loans, best match first per transaction.
 * `confident` ones are what the automatic linking would link.
 */
export async function findLoanPaymentCandidates(userId: string, opts: { loanId?: string; transactionIds?: string[]; limit?: number } = {}) {
  const loans = await activeLoans(userId);
  if (!loans.length) return [];
  const earliest = new Date(Math.min(...loans.map((l) => l.firstEmiDate.getTime())) - 15 * DAY);
  const txns = await prisma.transaction.findMany({
    where: { AND: [linkableWhere(userId, earliest), opts.transactionIds ? { id: { in: opts.transactionIds } } : {}] },
    orderBy: { transactionDate: "desc" },
    take: 2000,
    select: { id: true, transactionDate: true, amount: true, description: true, merchantName: true, transactionType: true, loanId: true, bankAccount: { select: { nickname: true } }, cashAccount: { select: { name: true } } },
  });
  const forMatch: (LoanForMatch & { firstEmiDate: Date })[] = loans.map((l) => ({
    id: l.id, lender: l.lender, name: l.name, accountLast4: l.accountLast4, emiAmount: l.emiAmount, dueDates: l.schedule.map((r) => r.dueDate), firstEmiDate: l.firstEmiDate,
  }));
  const out = [];
  for (const t of txns) {
    // A loan only matches payments made after its first EMI could be due.
    const eligible = forMatch.filter((l) => t.transactionDate.getTime() >= l.firstEmiDate.getTime() - 15 * DAY && (!t.loanId || t.loanId === l.id));
    const m = bestLoanMatch(t, eligible);
    if (!m || (opts.loanId && m.loanId !== opts.loanId)) continue;
    const loan = loans.find((l) => l.id === m.loanId)!;
    // Recorded on the loan by hand already (same amount within 3 days)? Then don't suggest it again.
    if (loan.payments.some((p) => Math.abs(p.paymentDate.getTime() - t.transactionDate.getTime()) <= 3 * DAY && toDecimal(p.amount).equals(t.amount))) continue;
    const near = loan.schedule
      .map((r) => ({ r, d: Math.abs(r.dueDate.getTime() - t.transactionDate.getTime()) }))
      .sort((a, b) => a.d - b.d)[0];
    out.push({
      transactionId: t.id,
      date: t.transactionDate,
      amount: toDecimal(t.amount),
      description: t.description,
      account: t.bankAccount?.nickname ?? t.cashAccount?.name ?? null,
      loanId: m.loanId,
      loanLabel: loan.lender === loan.name ? loan.name : `${loan.lender} — ${loan.name}`,
      score: m.score,
      confident: m.confident,
      reasons: m.reasons,
      suggestedScheduleId: near && near.d <= 20 * DAY ? near.r.id : (loan.schedule[0]?.id ?? null),
    });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}
export type LoanPaymentCandidate = Awaited<ReturnType<typeof findLoanPaymentCandidates>>[number];

/** Links one existing bank / cash debit to a loan (as an EMI of the chosen instalment, a prepayment, …). */
export async function linkTransactionToLoan(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(linkLoanPaymentSchema, input);
  return recordLoanPayment(
    userId,
    d.loanId,
    // Date and amount come from the linked transaction; these placeholders are replaced.
    { paymentType: d.paymentType, paymentDate: "2000-01-01", amount: "1", recordInLedger: false, scheduleId: d.scheduleId },
    meta,
    { linkTransactionId: d.transactionId },
  );
}

/**
 * Links the clear matches automatically, oldest first so instalments are paid in order.
 * Used after a bank statement is imported and from "Link all clear matches".
 */
export async function autoLinkLoanPayments(userId: string, opts: { transactionIds?: string[] } = {}, meta: RequestMeta = NO_META) {
  if (opts.transactionIds && !opts.transactionIds.length) return { linked: 0, suggestions: 0 };
  const candidates = await findLoanPaymentCandidates(userId, { transactionIds: opts.transactionIds });
  const sure = candidates.filter((c) => c.confident).sort((a, b) => a.date.getTime() - b.date.getTime());
  let linked = 0;
  for (const c of sure) {
    try {
      await recordLoanPayment(userId, c.loanId, { paymentType: "EMI", paymentDate: "2000-01-01", amount: "1", recordInLedger: false }, meta, { linkTransactionId: c.transactionId });
      linked++;
    } catch (e) {
      // e.g. the loan has no unpaid instalment left, or the amount is more than what's owed: leave it for review.
      if (!(e instanceof AppError)) logger.warn("loan_autolink_failed", { error: e });
    }
  }
  return { linked, suggestions: candidates.length - linked };
}
