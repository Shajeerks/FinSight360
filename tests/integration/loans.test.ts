import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createLoan, deleteLoanPayment, getLoanDetail, getLoansOverview, recordLoanPayment, reviseInterestRate } from "@/services/loan.service";
import { deleteTransaction } from "@/services/transaction.service";
import { getDashboardData } from "@/services/dashboard.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { resetDatabase } from "./helpers";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthsFromNow = (n: number, day = 5) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, day));
};

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
    if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
  }
}

const baseLoan = (extra: Record<string, unknown> = {}) => ({
  name: "Car loan", lender: "HDFC Bank", loanType: "CAR", principal: "1000000", interestRate: "9.5", tenureMonths: 60,
  startDate: iso(monthsFromNow(0, 1)), firstEmiDate: iso(monthsFromNow(1)), ...extra,
});

describe("Phase 3 loans (integration)", () => {
  let userId: string;
  let bankRef: string;
  let bankId: string;

  beforeEach(async () => {
    await resetDatabase();
    await seedCategories();
    const u = await prisma.user.create({ data: { email: "loan@example.com", name: "Loan User" } });
    userId = u.id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", currentBalance: "500000" }, meta)).id;
    bankRef = `bank:${bankId}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ACCEPTANCE §49 via the service: ₹10,00,000 @ 9.5% × 60 creates a valid 60-row schedule", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    expect(loan.emiAmount.toFixed(2)).toBe("21001.86");
    expect(loan.outstandingPrincipal.toFixed(2)).toBe("1000000.00");
    const rows = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: loan.id }, orderBy: { installmentNumber: "asc" } });
    expect(rows).toHaveLength(60);
    for (const r of rows) {
      expect(r.openingPrincipal.minus(r.principalComponent).equals(r.closingPrincipal)).toBe(true);
      expect(r.principalComponent.plus(r.interestComponent).equals(r.emiAmount)).toBe(true);
    }
    expect(rows[59].closingPrincipal.toFixed(2)).toBe("0.00");
    expect(await prisma.auditLog.count({ where: { action: "loan.created" } })).toBe(1);
  });

  it("marks past EMIs as paid for an existing loan (no ledger entries)", async () => {
    const loan = await createLoan(userId, baseLoan({ startDate: iso(monthsFromNow(-13, 1)), firstEmiDate: iso(monthsFromNow(-12)), markPastAsPaid: true }), meta);
    const paid = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: loan.id, status: "PAID" }, orderBy: { installmentNumber: "asc" } });
    expect(paid.length).toBeGreaterThanOrEqual(12);
    expect(loan.outstandingPrincipal.toFixed(2)).toBe(paid[paid.length - 1].closingPrincipal.toFixed(2));
    expect(await prisma.transaction.count({ where: { loanId: loan.id } })).toBe(0);
  });

  it("records an exact EMI: schedule row paid, split matches, ledger + balance + dashboard updated", async () => {
    const loan = await createLoan(userId, baseLoan({ repaymentAccountId: bankId }), meta);
    const today = iso(new Date());
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: today, amount: "21001.86", account: bankRef }, meta);
    const d = await getLoanDetail(userId, loan.id);
    expect(d.schedule[0].status).toBe("PAID");
    expect(d.payments[0].interestComponent.toFixed(2)).toBe("7916.67");
    expect(d.payments[0].principalComponent.toFixed(2)).toBe("13085.19");
    expect(d.loan.outstandingPrincipal.toFixed(2)).toBe("986914.81");
    expect(d.schedule).toHaveLength(60); // exact payment → no re-projection needed
    const t = await prisma.transaction.findFirstOrThrow({ where: { loanId: loan.id }, include: { category: true, subCategory: true } });
    expect(t.transactionType).toBe("EMI");
    expect(t.category?.name).toBe("EMI");
    expect(t.subCategory?.name).toBe("Car Loan");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("478998.14");
    const now = new Date();
    const dash = await getDashboardData(userId, { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
    expect(dash.current.emi.toFixed(2)).toBe("21001.86");
    expect(dash.current.interestPaid.toFixed(2)).toBe("7916.67");
    expect(dash.current.principalPaid.toFixed(2)).toBe("13085.19");
  });

  it("a short EMI part-pays the instalment, re-projects, and the next payment completes it", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    const today = iso(new Date());
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: today, amount: "10000", recordInLedger: false }, meta);
    let d = await getLoanDetail(userId, loan.id);
    expect(d.schedule[0].status).toBe("PARTIALLY_PAID");
    expect(d.payments[0].interestComponent.toFixed(2)).toBe("7916.67"); // interest first
    expect(d.loan.outstandingPrincipal.toFixed(2)).toBe("997916.67");
    expect(d.schedule.length).toBeGreaterThan(60); // tenure extends when EMI kept
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: today, amount: "11001.86", recordInLedger: false }, meta);
    d = await getLoanDetail(userId, loan.id);
    expect(d.schedule[0].status).toBe("PAID");
    expect(d.schedule[0].actualPaid.toFixed(2)).toBe("21001.86");
    expect(d.loan.outstandingPrincipal.toFixed(2)).toBe("986914.81");
  });

  it("prepayment: reduce tenure keeps EMI; reduce EMI keeps tenure", async () => {
    const a = await createLoan(userId, baseLoan({ name: "Loan A" }), meta);
    await recordLoanPayment(userId, a.id, { paymentType: "PREPAYMENT", paymentDate: iso(new Date()), amount: "200000", recordInLedger: false, prepaymentMode: "REDUCE_TENURE" }, meta);
    const da = await getLoanDetail(userId, a.id);
    expect(da.loan.emiAmount.toFixed(2)).toBe("21001.86");
    expect(da.analysis.remainingInstallments).toBeLessThan(60);
    expect(da.loan.totalPrepayments.toFixed(2)).toBe("200000.00");

    const b = await createLoan(userId, baseLoan({ name: "Loan B" }), meta);
    await recordLoanPayment(userId, b.id, { paymentType: "PREPAYMENT", paymentDate: iso(new Date()), amount: "200000", recordInLedger: false, prepaymentMode: "REDUCE_EMI" }, meta);
    const db = await getLoanDetail(userId, b.id);
    expect(db.loan.emiAmount.lessThan(21001.86)).toBe(true);
    expect(db.analysis.remainingInstallments).toBe(60);
    expect(db.analysis.futureInterest.lessThan(da.analysis.futureInterest)).toBe(false); // reducing tenure saves more interest
  });

  it("foreclosure closes the loan; overpayments are rejected", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    await expect(recordLoanPayment(userId, loan.id, { paymentType: "PREPAYMENT", paymentDate: iso(new Date()), amount: "1000000", recordInLedger: false }, meta)).rejects.toMatchObject({ code: "OVERPAYMENT" });
    await expect(recordLoanPayment(userId, loan.id, { paymentType: "FORECLOSURE", paymentDate: iso(new Date()), amount: "999999", recordInLedger: false }, meta)).rejects.toMatchObject({ code: "UNDERPAYMENT" });
    await recordLoanPayment(userId, loan.id, { paymentType: "FORECLOSURE", paymentDate: iso(new Date()), amount: "1012000", account: bankRef }, meta);
    const d = await getLoanDetail(userId, loan.id);
    expect(d.loan.status).toBe("FORECLOSED");
    expect(d.loan.outstandingPrincipal.toFixed(2)).toBe("0.00");
    expect(d.analysis.remainingInstallments).toBe(0);
    expect(d.analysis.chargesPaid.toFixed(2)).toBe("12000.00");
    await expect(recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: iso(new Date()), amount: "100", recordInLedger: false }, meta)).rejects.toMatchObject({ code: "LOAN_CLOSED" });
  });

  it("undoing a payment removes its ledger entry and restores the schedule and balance", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    const p = await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: iso(new Date()), amount: "15000", account: bankRef }, meta);
    const tx = await prisma.transaction.findFirstOrThrow({ where: { loanId: loan.id } });
    // Ledger entry can't be deleted from the transactions list (keeps schedule consistent)
    await expect(deleteTransaction(userId, tx.id, meta)).rejects.toMatchObject({ code: "LOAN_PAYMENT_LOCKED" });
    await deleteLoanPayment(userId, loan.id, p.id, meta);
    const d = await getLoanDetail(userId, loan.id);
    expect(d.payments).toHaveLength(0);
    expect(d.loan.outstandingPrincipal.toFixed(2)).toBe("1000000.00");
    expect(d.schedule).toHaveLength(60);
    expect(d.schedule[0].status).toBe("UPCOMING");
    expect(d.schedule[0].interestComponent.toFixed(2)).toBe("7916.67");
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } })).deletedAt).not.toBeNull();
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("500000.00");
  });

  it("revises a floating rate: keep tenure changes EMI, keep EMI changes tenure", async () => {
    const loan = await createLoan(userId, baseLoan({ interestType: "FLOATING" }), meta);
    await reviseInterestRate(userId, loan.id, { interestRate: "10.5", mode: "KEEP_TENURE" }, meta);
    let d = await getLoanDetail(userId, loan.id);
    expect(d.loan.emiAmount.greaterThan(21001.86)).toBe(true);
    expect(d.analysis.remainingInstallments).toBe(60);
    await reviseInterestRate(userId, loan.id, { interestRate: "8.5", mode: "KEEP_EMI" }, meta);
    d = await getLoanDetail(userId, loan.id);
    expect(d.analysis.remainingInstallments).toBeLessThan(60);
    await expect(reviseInterestRate(userId, loan.id, { interestRate: "59", mode: "KEEP_EMI" }, meta)).rejects.toMatchObject({ code: "EMI_TOO_SMALL" });
  });

  it("overview totals and interest analysis", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: iso(new Date()), amount: "21001.86", recordInLedger: false }, meta);
    const o = await getLoansOverview(userId);
    expect(o.totals.outstanding.toFixed(2)).toBe("986914.81");
    expect(o.totals.monthlyEmi.toFixed(2)).toBe("21001.86");
    expect(o.totals.interestPaidThisMonth.toFixed(2)).toBe("7916.67");
    expect(o.totals.futureInterest.greaterThan(250000)).toBe(true);
    expect(o.loans[0].remainingInstallments).toBe(59);
  });

  it("can't touch another user's loan", async () => {
    const loan = await createLoan(userId, baseLoan(), meta);
    const other = await prisma.user.create({ data: { email: "x@example.com" } });
    await expect(recordLoanPayment(other.id, loan.id, { paymentType: "EMI", paymentDate: iso(new Date()), amount: "1", recordInLedger: false }, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLoanDetail(other.id, loan.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
