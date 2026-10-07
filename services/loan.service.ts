import "server-only";
import type { Prisma, Loan, LoanAmortizationSchedule } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { Decimal, roundMoney, sum, toDecimal, percentOf } from "@/lib/money";
import {
  MONTHS_PER_PERIOD,
  calculateEmi,
  emiForInstallments,
  generateAmortizationSchedule,
  nextInstallmentDate,
  projectRemainingSchedule,
  type Frequency,
} from "@/lib/finance/amortization";
import { todayInTimezone, DEFAULT_TIMEZONE } from "@/lib/dates";
import { emiPreviewSchema, loanDetailsSchema, loanPaymentSchema, loanProgressSchema, loanSchema, rateRevisionSchema } from "@/validators/loans";
import { assertAccountRef } from "@/services/account.service";
import { createTransactionWithin, deleteTransactionWithin } from "@/services/transaction.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

const LOAN_SUBCATEGORY: Record<string, string> = { HOME: "Home Loan", CAR: "Car Loan", PERSONAL: "Personal Loan", EDUCATION: "Education Loan", OTHER: "Personal Loan" };

// ───────────────────────────── helpers ─────────────────────────────

async function ownedLoan(db: Tx | typeof prisma, userId: string, id: string) {
  const loan = await db.loan.findFirst({ where: { id, userId, deletedAt: null } });
  if (!loan) throw new NotFoundError("Loan not found.");
  return loan;
}

async function lockLoan(tx: Tx, loanId: string) {
  await tx.$queryRaw`SELECT id FROM "loans" WHERE id = ${loanId} FOR UPDATE`;
}

/** Re-derive paid totals / outstanding / status from the payment records (never incremented). */
async function syncLoanTotals(tx: Tx, loanId: string) {
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId } });
  const payments = await tx.loanPayment.findMany({ where: { loanId, deletedAt: null }, orderBy: { paymentDate: "asc" } });
  const principalPaid = roundMoney(sum(payments.map((p) => p.principalComponent)));
  const interestPaid = roundMoney(sum(payments.map((p) => p.interestComponent)));
  const totalPrepayments = roundMoney(sum(payments.filter((p) => p.paymentType === "PREPAYMENT").map((p) => p.principalComponent)));
  const outstanding = Decimal.max(loan.originalPrincipal.minus(principalPaid), 0);
  const foreclosure = payments.find((p) => p.paymentType === "FORECLOSURE");
  const status = foreclosure ? "FORECLOSED" : outstanding.isZero() ? "CLOSED" : "ACTIVE";
  const closureDate = status === "ACTIVE" ? null : (foreclosure?.paymentDate ?? payments[payments.length - 1]?.paymentDate ?? null);
  return tx.loan.update({ where: { id: loanId }, data: { principalPaid, interestPaid, totalPrepayments, outstandingPrincipal: roundMoney(outstanding), status, closureDate } });
}

/** Replace all not-yet-paid instalments with a fresh projection from the current outstanding. */
async function rebuildFutureSchedule(tx: Tx, loan: Loan) {
  // Keep every row up to the last instalment that has a payment — an unpaid row
  // before it stays as overdue. Only rows after it are re-projected.
  const lastPaidRow = await tx.loanAmortizationSchedule.findFirst({
    where: { loanId: loan.id, payments: { some: { deletedAt: null } } },
    orderBy: { installmentNumber: "desc" },
    select: { installmentNumber: true },
  });
  const lastPaid = lastPaidRow?.installmentNumber ?? 0;
  await tx.loanAmortizationSchedule.deleteMany({
    where: { loanId: loan.id, installmentNumber: { gt: lastPaid }, status: { in: ["UPCOMING", "MISSED"] }, payments: { none: { deletedAt: null } } },
  });
  if (loan.status !== "ACTIVE" || loan.outstandingPrincipal.lessThanOrEqualTo(0)) return;
  const last = await tx.loanAmortizationSchedule.findFirst({ where: { loanId: loan.id }, orderBy: { installmentNumber: "desc" } });
  // Principal already scheduled in kept-but-unpaid (overdue) rows isn't projected again.
  const overdue = await tx.loanAmortizationSchedule.aggregate({
    where: { loanId: loan.id, installmentNumber: { lte: lastPaid }, payments: { none: { deletedAt: null } } },
    _sum: { principalComponent: true },
  });
  const toProject = loan.outstandingPrincipal.minus(toDecimal(overdue._sum.principalComponent ?? 0));
  if (toProject.lessThanOrEqualTo(0)) return;
  const frequency = loan.emiFrequency as Frequency;
  const nextDue = last ? nextInstallmentDate(last.dueDate, frequency, loan.emiDueDay) : loan.firstEmiDate;
  const rows = projectRemainingSchedule({
    outstanding: toProject,
    annualRatePct: loan.interestRate,
    frequency,
    emi: loan.emiAmount,
    nextDueDate: nextDue,
    startInstallment: (last?.installmentNumber ?? 0) + 1,
    anchorDay: loan.emiDueDay,
  });
  await tx.loanAmortizationSchedule.createMany({
    data: rows.map((r) => ({
      loanId: loan.id,
      installmentNumber: r.installmentNumber,
      dueDate: r.dueDate,
      openingPrincipal: r.openingPrincipal,
      emiAmount: r.emi,
      principalComponent: r.principal,
      interestComponent: r.interest,
      closingPrincipal: r.closingPrincipal,
      status: "UPCOMING",
    })),
  });
}

async function emiCategory(tx: Tx, loanType: string, isCharge: boolean) {
  const catName = isCharge ? "Fees & Charges" : "EMI";
  const subName = isCharge ? "Late Fees" : LOAN_SUBCATEGORY[loanType];
  const cat = await tx.category.findFirst({ where: { userId: null, name: catName, kind: "EXPENSE", deletedAt: null }, include: { subCategories: { where: { name: subName } } } });
  return { categoryId: cat?.id ?? null, subCategoryId: cat?.subCategories[0]?.id ?? null };
}

// ───────────────────────────── preview / create ─────────────────────────────

export function previewEmi(input: unknown) {
  const d = parseOrThrow(emiPreviewSchema, input);
  const emi = calculateEmi(d.principal, d.interestRate, d.tenureMonths, d.emiFrequency, d.roundEmiToRupee);
  const n = d.tenureMonths / MONTHS_PER_PERIOD[d.emiFrequency];
  const rows = generateAmortizationSchedule({ principal: d.principal, annualRatePct: d.interestRate, tenureMonths: d.tenureMonths, frequency: d.emiFrequency, firstDueDate: new Date(Date.UTC(2000, 0, 1)), emi });
  const totalInterest = roundMoney(sum(rows.map((r) => r.interest)));
  return { emi: emi.toFixed(2), installments: n, totalInterest: totalInterest.toFixed(2), totalPayment: roundMoney(toDecimal(d.principal).plus(totalInterest)).toFixed(2) };
}

export async function createLoan(userId: string, input: unknown, meta: RequestMeta = NO_META, timezone = DEFAULT_TIMEZONE) {
  const d = parseOrThrow(loanSchema, input);
  if (d.repaymentAccountId) await assertAccountRef(prisma, userId, { kind: "bank", id: d.repaymentAccountId });
  const frequency = d.emiFrequency as Frequency;
  let rows;
  try {
    rows = generateAmortizationSchedule({
      principal: d.principal,
      annualRatePct: d.interestRate,
      tenureMonths: d.tenureMonths,
      frequency,
      firstDueDate: d.firstEmiDate,
      emi: d.emiAmount ?? undefined,
      roundEmiToRupee: d.roundEmiToRupee,
    });
  } catch (e) {
    throw new AppError((e as Error).message, 400, "INVALID_LOAN_TERMS", { emiAmount: [(e as Error).message] });
  }
  const emi = rows[0].emi;
  const today = todayInTimezone(timezone);

  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        userId,
        name: d.name,
        lender: d.lender,
        loanType: d.loanType,
        accountLast4: d.accountLast4,
        originalPrincipal: roundMoney(d.principal),
        interestRate: toDecimal(d.interestRate),
        interestType: d.interestType,
        startDate: d.startDate,
        firstEmiDate: d.firstEmiDate,
        tenureMonths: d.tenureMonths,
        emiAmount: emi,
        emiFrequency: frequency,
        emiDueDay: d.firstEmiDate.getUTCDate(),
        outstandingPrincipal: roundMoney(d.principal),
        repaymentAccountId: d.repaymentAccountId,
        notes: d.notes,
      },
    });
    await tx.loanAmortizationSchedule.createMany({
      data: rows.map((r) => ({
        loanId: loan.id,
        installmentNumber: r.installmentNumber,
        dueDate: r.dueDate,
        openingPrincipal: r.openingPrincipal,
        emiAmount: r.emi,
        principalComponent: r.principal,
        interestComponent: r.interest,
        closingPrincipal: r.closingPrincipal,
        status: "UPCOMING" as const,
      })),
    });
    if (d.emisPaid !== null || d.outstandingAsPerBank !== null) {
      const n = d.emisPaid ?? rows.filter((r) => r.dueDate < today).length;
      await applyOpeningProgress(tx, loan.id, n, d.outstandingAsPerBank === null ? null : toDecimal(d.outstandingAsPerBank), today);
    } else if (d.markPastAsPaid) {
      await tx.loanAmortizationSchedule.updateMany({ where: { loanId: loan.id, dueDate: { lt: today } }, data: { status: "PAID" } });
      const paid = await tx.loanAmortizationSchedule.findMany({ where: { loanId: loan.id, status: "PAID" } });
      if (paid.length) {
        await tx.loanPayment.createMany({
          data: paid.map((r) => ({
            loanId: loan.id,
            scheduleId: r.id,
            paymentDate: r.dueDate,
            paymentType: "EMI" as const,
            amount: r.emiAmount,
            principalComponent: r.principalComponent,
            interestComponent: r.interestComponent,
            isOpening: true,
            notes: "Marked as paid when the loan was added",
          })),
        });
      }
      await syncLoanTotals(tx, loan.id);
    }
    await audit({ userId, action: AuditAction.LOAN_CREATED, entityType: "Loan", entityId: loan.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { loanType: d.loanType, markPastAsPaid: d.markPastAsPaid, emisPaid: d.emisPaid } }, tx);
    return tx.loan.findUniqueOrThrow({ where: { id: loan.id } });
  });
}

// ───────────────────────────── paid before FinSight360 ─────────────────────────────

/**
 * Record repayment made before the loan was tracked here: the first `emisPaid`
 * instalments are marked paid and, when the lender's outstanding is given, the
 * principal repaid is matched to it (any extra is shown as a part-prepayment).
 * These "opening" payments never touch the ledger. Calling it again replaces the
 * previous opening entries. The remaining schedule is re-projected from the
 * resulting outstanding with the same EMI.
 */
async function applyOpeningProgress(tx: Tx, loanId: string, emisPaid: number, bankOutstanding: Decimal | null, asOf: Date) {
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: loanId } });
  const real = await tx.loanPayment.findMany({ where: { loanId, deletedAt: null, isOpening: false }, include: { schedule: { select: { installmentNumber: true } } } });
  if (real.length && bankOutstanding !== null) {
    throw new AppError("The outstanding is already worked out from the payments you've recorded in FinSight360. Undo those payments first, or record a prepayment instead.", 409, "PAYMENTS_RECORDED", { outstandingAsPerBank: ["Leave blank — payments are already recorded"] });
  }
  if (bankOutstanding !== null && bankOutstanding.greaterThan(loan.originalPrincipal)) {
    throw new AppError("The outstanding can't be more than the loan amount.", 400, "INVALID_OUTSTANDING", { outstandingAsPerBank: ["Can't exceed the principal"] });
  }
  const firstReal = real.length ? Math.min(...real.map((p) => p.schedule?.installmentNumber ?? Number.MAX_SAFE_INTEGER)) : null;

  // Remove the previous opening entries.
  await tx.loanPayment.deleteMany({ where: { loanId, isOpening: true } });

  if (!real.length) {
    // Nothing recorded yet: start again from the original schedule.
    await tx.loanAmortizationSchedule.deleteMany({ where: { loanId } });
    const rows = generateAmortizationSchedule({
      principal: loan.originalPrincipal,
      annualRatePct: loan.interestRate,
      tenureMonths: loan.tenureMonths,
      frequency: loan.emiFrequency as Frequency,
      firstDueDate: loan.firstEmiDate,
      emi: loan.emiAmount,
    });
    await tx.loanAmortizationSchedule.createMany({
      data: rows.map((r) => ({ loanId, installmentNumber: r.installmentNumber, dueDate: r.dueDate, openingPrincipal: r.openingPrincipal, emiAmount: r.emi, principalComponent: r.principal, interestComponent: r.interest, closingPrincipal: r.closingPrincipal, status: "UPCOMING" as const })),
    });
  } else {
    await tx.loanAmortizationSchedule.updateMany({ where: { loanId, status: "PAID", payments: { none: { deletedAt: null } } }, data: { status: "UPCOMING" } });
  }

  const schedule = await tx.loanAmortizationSchedule.findMany({ where: { loanId }, orderBy: { installmentNumber: "asc" } });
  const maxPaid = firstReal !== null ? Math.min(firstReal - 1, schedule.length) : schedule.length;
  if (emisPaid > maxPaid) {
    const msg = firstReal !== null
      ? `EMI #${firstReal} is already recorded in FinSight360, so at most ${maxPaid} EMI(s) can be marked as paid before it.`
      : `This loan has ${schedule.length} EMIs in total.`;
    throw new AppError(msg, 400, "TOO_MANY_EMIS", { emisPaid: [`At most ${maxPaid}`] });
  }
  const paidRows = schedule.slice(0, emisPaid);

  // Principal split: as scheduled, or matched to the lender's outstanding.
  let principals = paidRows.map((r) => r.principalComponent);
  let extraPrincipal = new Decimal(0);
  if (bankOutstanding !== null) {
    const target = roundMoney(loan.originalPrincipal.minus(bankOutstanding));
    const scheduled = sum(principals);
    if (target.lessThan(scheduled)) {
      // Repaid less principal than scheduled (e.g. higher effective rate): scale down, rest is interest.
      const factor = scheduled.isZero() ? new Decimal(0) : target.dividedBy(scheduled);
      principals = principals.map((p) => roundMoney(p.times(factor)));
      const diff = target.minus(sum(principals));
      if (principals.length) principals[principals.length - 1] = principals[principals.length - 1].plus(diff);
    } else {
      extraPrincipal = target.minus(scheduled);
    }
  }

  if (paidRows.length) {
    await tx.loanPayment.createMany({
      data: paidRows.map((r, i) => ({
        loanId, scheduleId: r.id, paymentDate: r.dueDate, paymentType: "EMI" as const, amount: r.emiAmount,
        principalComponent: principals[i], interestComponent: Decimal.max(r.emiAmount.minus(principals[i]), 0),
        isOpening: true, notes: "Paid before FinSight360",
      })),
    });
    await tx.loanAmortizationSchedule.updateMany({ where: { id: { in: paidRows.map((r) => r.id) } }, data: { status: "PAID" } });
  }
  if (extraPrincipal.greaterThan(0)) {
    await tx.loanPayment.create({
      data: { loanId, paymentDate: asOf, paymentType: "PREPAYMENT", amount: extraPrincipal, principalComponent: extraPrincipal, interestComponent: 0, isOpening: true, notes: "Extra principal repaid before FinSight360 (to match the lender's outstanding)" },
    });
  }
  const updated = await syncLoanTotals(tx, loanId);
  await rebuildFutureSchedule(tx, updated);
  return updated;
}

/** Update "EMIs already paid" / "outstanding as per bank" for an existing loan. */
export async function setLoanProgress(userId: string, loanId: string, input: unknown, meta: RequestMeta = NO_META, timezone = DEFAULT_TIMEZONE) {
  const d = parseOrThrow(loanProgressSchema, input);
  await ownedLoan(prisma, userId, loanId);
  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    const loan = await applyOpeningProgress(tx, loanId, d.emisPaid, d.outstandingAsPerBank === null ? null : toDecimal(d.outstandingAsPerBank), todayInTimezone(timezone));
    await audit({ userId, action: AuditAction.LOAN_UPDATED, entityType: "Loan", entityId: loanId, ip: meta.ip, userAgent: meta.userAgent, metadata: { emisPaid: d.emisPaid, outstandingGiven: d.outstandingAsPerBank !== null } }, tx);
    return loan;
  });
}

export async function updateLoanDetails(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  await ownedLoan(prisma, userId, id);
  const d = parseOrThrow(loanDetailsSchema, input);
  if (d.repaymentAccountId) await assertAccountRef(prisma, userId, { kind: "bank", id: d.repaymentAccountId });
  const loan = await prisma.loan.update({ where: { id }, data: { name: d.name, lender: d.lender, accountLast4: d.accountLast4, interestType: d.interestType, repaymentAccountId: d.repaymentAccountId, notes: d.notes } });
  await audit({ userId, action: AuditAction.LOAN_UPDATED, entityType: "Loan", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return loan;
}

/** Soft delete. Ledger entries of its payments are kept (they are real money movements). */
export async function deleteLoan(userId: string, id: string, meta: RequestMeta = NO_META) {
  await ownedLoan(prisma, userId, id);
  await prisma.loan.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ userId, action: AuditAction.LOAN_DELETED, entityType: "Loan", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

// ───────────────────────────── payments ─────────────────────────────

/**
 * Record an actual payment against the loan.
 *  • EMI — pays the next unpaid instalment (or the one chosen). Interest due on
 *    that instalment is paid first; the rest reduces principal. Short or extra
 *    payments re-project the remaining schedule (EMI kept, tenure adjusts).
 *  • PREPAYMENT — all principal; then either shorten tenure or lower the EMI.
 *  • FORECLOSURE — clears the outstanding; anything above it is charges/interest.
 *  • CHARGE — penalty/late fee; doesn't change principal.
 * Optionally writes the matching ledger transaction (EMI / Fee) from a bank or cash account.
 */
export async function recordLoanPayment(userId: string, loanId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(loanPaymentSchema, input);
  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    let loan = await ownedLoan(tx, userId, loanId);
    if (d.paymentType !== "CHARGE" && loan.status !== "ACTIVE") throw new AppError("This loan is already closed.", 409, "LOAN_CLOSED");
    const amount = roundMoney(d.amount);
    const outstanding = loan.outstandingPrincipal;
    let principal = new Decimal(0);
    let interest = new Decimal(0);
    let charges = new Decimal(0);
    let row: LoanAmortizationSchedule | null = null;

    // An EMI may finish a part-paid instalment and pay the next one (split into two parts).
    let parts: { row: LoanAmortizationSchedule; amount: Decimal; interest: Decimal; principal: Decimal }[] = [];
    if (d.paymentType === "EMI") {
      row = d.scheduleId
        ? await tx.loanAmortizationSchedule.findFirst({ where: { id: d.scheduleId, loanId, status: { in: ["UPCOMING", "PARTIALLY_PAID", "MISSED"] } } })
        : await tx.loanAmortizationSchedule.findFirst({ where: { loanId, status: { in: ["UPCOMING", "PARTIALLY_PAID", "MISSED"] } }, orderBy: { installmentNumber: "asc" } });
      if (!row) throw new AppError("There is no unpaid instalment to apply this EMI to.", 409, "NO_INSTALMENT", { scheduleId: ["Choose an unpaid instalment"] });
      const allocate = async (r: LoanAmortizationSchedule, amt: Decimal) => {
        const already = await tx.loanPayment.aggregate({ where: { scheduleId: r.id, deletedAt: null }, _sum: { interestComponent: true } });
        const interestDue = Decimal.max(r.interestComponent.minus(already._sum.interestComponent ?? 0), 0);
        const i = Decimal.min(amt, interestDue);
        return { row: r, amount: amt, interest: i, principal: amt.minus(i) };
      };
      const paidSoFar = toDecimal((await tx.loanPayment.aggregate({ where: { scheduleId: row.id, deletedAt: null }, _sum: { amount: true } }))._sum.amount ?? 0);
      const remainingDue = Decimal.max(row.emiAmount.minus(paidSoFar), 0);
      const next = paidSoFar.greaterThan(0) && amount.greaterThan(remainingDue)
        ? await tx.loanAmortizationSchedule.findFirst({ where: { loanId, installmentNumber: { gt: row.installmentNumber }, status: { in: ["UPCOMING", "MISSED"] } }, orderBy: { installmentNumber: "asc" } })
        : null;
      if (next && remainingDue.greaterThan(0)) {
        parts = [await allocate(row, remainingDue), await allocate(next, amount.minus(remainingDue))];
      } else {
        parts = [await allocate(row, amount)];
      }
      interest = parts.reduce((a, x) => a.plus(x.interest), new Decimal(0));
      principal = amount.minus(interest);
      if (principal.greaterThan(outstanding)) {
        throw new AppError(`That's more than needed. ₹${outstanding.plus(interest).toFixed(2)} closes the loan — record it as a foreclosure.`, 400, "OVERPAYMENT", { amount: ["Amount exceeds what is owed"] });
      }
    } else if (d.paymentType === "PREPAYMENT") {
      if (amount.greaterThanOrEqualTo(outstanding)) {
        throw new AppError("A prepayment must be less than the outstanding principal. To close the loan, record a foreclosure.", 400, "OVERPAYMENT", { amount: [`Outstanding is ₹${outstanding.toFixed(2)}`] });
      }
      principal = amount;
    } else if (d.paymentType === "FORECLOSURE") {
      if (amount.lessThan(outstanding)) {
        throw new AppError(`Foreclosure needs at least the outstanding principal (₹${outstanding.toFixed(2)}).`, 400, "UNDERPAYMENT", { amount: [`At least ₹${outstanding.toFixed(2)}`] });
      }
      principal = outstanding;
      charges = amount.minus(outstanding);
    } else {
      charges = amount;
    }

    // Ledger entry (real money leaving a bank/cash account).
    let transactionId: string | null = null;
    if (d.recordInLedger) {
      const ref = d.account!;
      const cat = await emiCategory(tx, loan.loanType, d.paymentType === "CHARGE");
      const label = { EMI: `EMI${row ? ` #${row.installmentNumber}` : ""}`, PREPAYMENT: "prepayment", FORECLOSURE: "foreclosure", CHARGE: "charges" }[d.paymentType];
      const t = await createTransactionWithin(
        tx,
        userId,
        {
          kind: d.paymentType === "CHARGE" ? "FEE" : "EMI",
          transactionDate: d.paymentDate.toISOString().slice(0, 10),
          amount: amount.toFixed(2),
          account: ref,
          description: `${loan.lender} ${loan.name} ${label}`,
          merchantName: loan.lender,
          categoryId: cat.categoryId,
          subCategoryId: cat.subCategoryId,
          notes: d.notes,
        },
        meta,
        { loanId },
      );
      transactionId = t.id;
    }

    const base = { loanId, paymentDate: d.paymentDate, paymentType: d.paymentType, notes: d.notes };
    let payment;
    if (parts.length > 1) {
      payment = await tx.loanPayment.create({
        data: { ...base, scheduleId: parts[0].row.id, transactionId, amount: parts[0].amount, principalComponent: roundMoney(parts[0].principal), interestComponent: roundMoney(parts[0].interest), chargesComponent: 0 },
      });
      await tx.loanPayment.update({ where: { id: payment.id }, data: { groupId: payment.id } });
      for (const part of parts.slice(1)) {
        await tx.loanPayment.create({
          data: { ...base, groupId: payment.id, scheduleId: part.row.id, amount: part.amount, principalComponent: roundMoney(part.principal), interestComponent: roundMoney(part.interest), chargesComponent: 0, notes: d.notes ?? "Rest of the same payment" },
        });
      }
    } else {
      payment = await tx.loanPayment.create({
        data: { ...base, scheduleId: row?.id ?? null, transactionId, amount, principalComponent: roundMoney(principal), interestComponent: roundMoney(interest), chargesComponent: roundMoney(charges) },
      });
    }

    for (const r of parts.length ? parts.map((x) => x.row) : row ? [row] : []) {
      const paidOnRow = await tx.loanPayment.aggregate({ where: { scheduleId: r.id, deletedAt: null }, _sum: { amount: true } });
      const fullyPaid = toDecimal(paidOnRow._sum.amount).greaterThanOrEqualTo(r.emiAmount);
      await tx.loanAmortizationSchedule.update({ where: { id: r.id }, data: { status: fullyPaid ? "PAID" : "PARTIALLY_PAID" } });
    }

    const remainingBefore = await tx.loanAmortizationSchedule.count({ where: { loanId, status: "UPCOMING" } });
    loan = await syncLoanTotals(tx, loanId);
    if (d.paymentType === "PREPAYMENT" && d.prepaymentMode === "REDUCE_EMI" && remainingBefore > 0) {
      const newEmi = emiForInstallments(loan.outstandingPrincipal, loan.interestRate, remainingBefore, loan.emiFrequency as Frequency);
      loan = await tx.loan.update({ where: { id: loanId }, data: { emiAmount: newEmi } });
    }
    if (d.paymentType !== "CHARGE") {
      if (loan.status !== "ACTIVE") {
        await tx.loanAmortizationSchedule.deleteMany({ where: { loanId, status: { in: ["UPCOMING", "MISSED"] }, payments: { none: {} } } });
      } else {
        // Re-project only if the payment changed the principal path (short/extra EMI or prepayment).
        const scheduledPrincipal = parts.length > 1 ? new Decimal(-1) : row ? row.principalComponent : new Decimal(0);
        if (d.paymentType === "PREPAYMENT" || !principal.equals(scheduledPrincipal)) await rebuildFutureSchedule(tx, loan);
      }
    }

    await audit({ userId, action: AuditAction.LOAN_PAYMENT_RECORDED, entityType: "LoanPayment", entityId: payment.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { loanId, type: d.paymentType, ledger: Boolean(transactionId), mode: d.paymentType === "PREPAYMENT" ? d.prepaymentMode : undefined } }, tx);
    return payment;
  });
}

/** Undo a recorded payment (and its ledger entry); the schedule is re-projected. */
export async function deleteLoanPayment(userId: string, loanId: string, paymentId: string, meta: RequestMeta = NO_META) {
  await prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    await ownedLoan(tx, userId, loanId);
    const p = await tx.loanPayment.findFirst({ where: { id: paymentId, loanId, deletedAt: null } });
    if (!p) throw new NotFoundError("Payment not found.");
    // A payment split over two instalments is undone as a whole.
    const group = p.groupId ? await tx.loanPayment.findMany({ where: { groupId: p.groupId, loanId, deletedAt: null } }) : [p];
    for (const part of group) {
      await tx.loanPayment.update({ where: { id: part.id }, data: { deletedAt: new Date(), transactionId: null } });
      if (part.transactionId) await deleteTransactionWithin(tx, userId, part.transactionId, meta, { fromLoan: true });
    }
    for (const part of group) {
      if (!part.scheduleId) continue;
      const row = await tx.loanAmortizationSchedule.findUnique({ where: { id: part.scheduleId } });
      if (!row) continue;
      const left = await tx.loanPayment.aggregate({ where: { scheduleId: part.scheduleId, deletedAt: null }, _sum: { amount: true }, _count: true });
      const status = left._count === 0 ? "UPCOMING" : toDecimal(left._sum.amount).greaterThanOrEqualTo(row.emiAmount) ? "PAID" : "PARTIALLY_PAID";
      await tx.loanAmortizationSchedule.update({ where: { id: part.scheduleId }, data: { status } });
      if (status === "UPCOMING") {
        // Detach so the row can be re-projected; if a later instalment is already
        // paid, this one stays in place and shows as overdue.
        await tx.loanPayment.updateMany({ where: { scheduleId: part.scheduleId, deletedAt: { not: null } }, data: { scheduleId: null } });
      }
    }
    const loan = await syncLoanTotals(tx, loanId);
    await rebuildFutureSchedule(tx, loan);
    await audit({ userId, action: AuditAction.LOAN_PAYMENT_DELETED, entityType: "LoanPayment", entityId: p.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { loanId } }, tx);
  });
}

/** Floating-rate revision from the next unpaid instalment: keep the EMI (tenure changes) or keep the tenure (EMI changes). */
export async function reviseInterestRate(userId: string, loanId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(rateRevisionSchema, input);
  await prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    let loan = await ownedLoan(tx, userId, loanId);
    if (loan.status !== "ACTIVE") throw new AppError("This loan is closed.", 409, "LOAN_CLOSED");
    const remaining = await tx.loanAmortizationSchedule.count({ where: { loanId, status: "UPCOMING", payments: { none: {} } } });
    const data: Prisma.LoanUpdateInput = { interestRate: toDecimal(d.interestRate) };
    if (d.mode === "KEEP_TENURE" && remaining > 0) data.emiAmount = emiForInstallments(loan.outstandingPrincipal, d.interestRate, remaining, loan.emiFrequency as Frequency);
    loan = await tx.loan.update({ where: { id: loanId }, data });
    try {
      await rebuildFutureSchedule(tx, loan);
    } catch (e) {
      throw new AppError(`${(e as Error).message}. Choose “keep tenure” to raise the EMI instead.`, 400, "EMI_TOO_SMALL", { interestRate: [(e as Error).message] });
    }
    await audit({ userId, action: AuditAction.LOAN_RATE_REVISED, entityType: "Loan", entityId: loanId, ip: meta.ip, userAgent: meta.userAgent, metadata: { mode: d.mode } }, tx);
  });
}

// ───────────────────────────── queries & analysis ─────────────────────────────

function monthlyEquivalent(emi: Decimal, frequency: string) {
  return emi.div(MONTHS_PER_PERIOD[frequency as Frequency] ?? 1);
}

export async function getLoansOverview(userId: string, timezone = DEFAULT_TIMEZONE) {
  const today = todayInTimezone(timezone);
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const loans = await prisma.loan.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      schedule: { orderBy: { installmentNumber: "asc" } },
      payments: { where: { deletedAt: null }, select: { paymentDate: true, principalComponent: true, interestComponent: true, amount: true } },
    },
  });

  const rows = loans.map((l) => {
    const unpaid = l.schedule.filter((r) => r.status !== "PAID");
    const next = unpaid[0] ?? null;
    const overdue = unpaid.filter((r) => r.dueDate < today && r.status !== "PAID").length;
    const futureInterest = roundMoney(sum(l.schedule.filter((r) => r.status === "UPCOMING").map((r) => r.interestComponent)));
    return {
      id: l.id,
      name: l.name,
      lender: l.lender,
      loanType: l.loanType,
      status: l.status,
      interestRate: l.interestRate,
      interestType: l.interestType,
      emiAmount: l.emiAmount,
      emiFrequency: l.emiFrequency,
      originalPrincipal: l.originalPrincipal,
      outstandingPrincipal: l.outstandingPrincipal,
      principalPaid: l.principalPaid,
      interestPaid: l.interestPaid,
      repaidPct: percentOf(l.principalPaid, l.originalPrincipal, 1),
      paidInstallments: l.schedule.filter((r) => r.status === "PAID").length,
      remainingInstallments: unpaid.length,
      nextDue: next ? { dueDate: next.dueDate, amount: next.emiAmount, installmentNumber: next.installmentNumber, overdue: next.dueDate < today } : null,
      overdueCount: overdue,
      futureInterest,
    };
  });

  const active = loans.filter((l) => l.status === "ACTIVE");
  const allPayments = loans.flatMap((l) => l.payments);
  const interestPaid = roundMoney(sum(allPayments.map((p) => p.interestComponent)));
  const principalPaid = roundMoney(sum(allPayments.map((p) => p.principalComponent)));
  const futureInterest = roundMoney(sum(rows.map((r) => r.futureInterest)));

  // Interest vs principal paid per month (last 12 months).
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11 + i, 1));
    return { key: d.toISOString().slice(0, 7), start: d, end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
  });
  const monthly = months.map((m) => {
    const ps = allPayments.filter((p) => p.paymentDate >= m.start && p.paymentDate < m.end);
    return { key: m.key, principal: roundMoney(sum(ps.map((p) => p.principalComponent))), interest: roundMoney(sum(ps.map((p) => p.interestComponent))) };
  });

  return {
    today,
    loans: rows,
    totals: {
      outstanding: roundMoney(sum(active.map((l) => l.outstandingPrincipal))),
      monthlyEmi: roundMoney(sum(active.map((l) => monthlyEquivalent(l.emiAmount, l.emiFrequency)))),
      interestPaid,
      principalPaid,
      interestPaidThisYear: roundMoney(sum(allPayments.filter((p) => p.paymentDate >= yearStart).map((p) => p.interestComponent))),
      interestPaidThisMonth: roundMoney(sum(allPayments.filter((p) => p.paymentDate >= monthStart).map((p) => p.interestComponent))),
      futureInterest,
      interestToPrincipalPct: percentOf(interestPaid, principalPaid, 1),
    },
    monthly,
  };
}

export async function getLoanDetail(userId: string, id: string, timezone = DEFAULT_TIMEZONE) {
  const today = todayInTimezone(timezone);
  const loan = await prisma.loan.findFirst({
    where: { id, userId, deletedAt: null },
    include: {
      repaymentAccount: { select: { id: true, nickname: true, bankName: true } },
      schedule: { orderBy: { installmentNumber: "asc" }, include: { payments: { where: { deletedAt: null }, select: { amount: true, paymentDate: true } } } },
      payments: {
        where: { deletedAt: null },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        include: { schedule: { select: { installmentNumber: true } }, transaction: { select: { id: true, bankAccount: { select: { nickname: true } }, cashAccount: { select: { name: true } } } } },
      },
    },
  });
  if (!loan) throw new NotFoundError("Loan not found.");

  const schedule = loan.schedule.map((r) => {
    const actual = roundMoney(sum(r.payments.map((p) => p.amount)));
    return {
      ...r,
      actualPaid: actual,
      difference: roundMoney(actual.minus(r.emiAmount)),
      lastPaidOn: r.payments.length ? r.payments.map((p) => p.paymentDate).sort((a, b) => b.getTime() - a.getTime())[0] : null,
      overdue: r.status !== "PAID" && r.dueDate < today,
    };
  });
  const upcoming = schedule.filter((r) => r.status === "UPCOMING");
  const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const futureInterest = roundMoney(sum(upcoming.map((r) => r.interestComponent)));

  // Yearly principal vs interest: actual payments for the past, schedule for the future.
  const byYear = new Map<number, { principal: Decimal; interest: Decimal; projected: boolean }>();
  for (const p of loan.payments) {
    const y = p.paymentDate.getUTCFullYear();
    const cur = byYear.get(y) ?? { principal: new Decimal(0), interest: new Decimal(0), projected: false };
    byYear.set(y, { principal: cur.principal.plus(p.principalComponent), interest: cur.interest.plus(p.interestComponent), projected: cur.projected });
  }
  for (const r of upcoming) {
    const y = r.dueDate.getUTCFullYear();
    const cur = byYear.get(y) ?? { principal: new Decimal(0), interest: new Decimal(0), projected: true };
    byYear.set(y, { principal: cur.principal.plus(r.principalComponent), interest: cur.interest.plus(r.interestComponent), projected: true });
  }
  const yearly = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, principal: roundMoney(v.principal), interest: roundMoney(v.interest), projected: v.projected }));

  return {
    loan,
    schedule,
    payments: loan.payments,
    analysis: {
      outstanding: loan.outstandingPrincipal,
      principalPaid: loan.principalPaid,
      interestPaid: loan.interestPaid,
      interestPaidThisYear: roundMoney(sum(loan.payments.filter((p) => p.paymentDate >= yearStart).map((p) => p.interestComponent))),
      interestPaidThisMonth: roundMoney(sum(loan.payments.filter((p) => p.paymentDate >= monthStart).map((p) => p.interestComponent))),
      futureInterest,
      totalInterestCost: roundMoney(loan.interestPaid.plus(futureInterest)),
      interestToPrincipalPct: percentOf(loan.interestPaid, loan.principalPaid, 1),
      lifetimeInterestPct: percentOf(loan.interestPaid.plus(futureInterest), loan.originalPrincipal, 1),
      repaidPct: percentOf(loan.principalPaid, loan.originalPrincipal, 1),
      remainingInstallments: schedule.filter((r) => r.status !== "PAID").length,
      projectedClosure: upcoming.length ? upcoming[upcoming.length - 1].dueDate : loan.closureDate,
      overdueCount: schedule.filter((r) => r.overdue).length,
      chargesPaid: roundMoney(sum(loan.payments.map((p) => p.chargesComponent))),
    },
    yearly,
    balanceCurve: schedule.map((r) => ({ date: r.dueDate, closing: r.closingPrincipal, paid: r.status === "PAID" })),
  };
}

export type LoanDetail = Awaited<ReturnType<typeof getLoanDetail>>;
