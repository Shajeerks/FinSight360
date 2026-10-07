import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard, getCreditCardOverview, updateCreditCard } from "@/services/credit-card.service";
import { createLoan, getLoanDetail, recordLoanPayment, setLoanProgress } from "@/services/loan.service";
import { getReminderItems } from "@/services/reminder.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { sum } from "@/lib/money";
import { addDays, todayInTimezone } from "@/lib/dates";
import { meta, resetDatabase } from "./helpers";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => todayInTimezone("Asia/Kolkata");
const monthsAgo = (n: number, day = 5) => {
  const t = today();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, day));
};

/** ₹5,00,000 at 10% for 60 months, first EMI 14 months ago on the 5th. */
const baseLoan = (extra: Record<string, unknown> = {}) => ({
  name: "Personal loan", lender: "HDFC Bank", loanType: "PERSONAL", principal: "500000", interestRate: "10", tenureMonths: 60,
  startDate: iso(monthsAgo(15)), firstEmiDate: iso(monthsAgo(14)), ...extra,
});

describe("Paid till date — loans and credit cards (integration)", () => {
  let userId: string;
  let bankId: string;

  beforeEach(async () => {
    await resetDatabase();
    for (const c of DEFAULT_CATEGORIES) {
      const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
      if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
    }
    userId = (await prisma.user.create({ data: { email: "paid@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC", nickname: "Salary", accountType: "SALARY", currentBalance: "200000" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  /** EMIs on the 5th from 14 months ago that fall before today. */
  const dueBeforeToday = () => {
    let n = 0;
    for (let i = 14; i >= 0; i--) if (monthsAgo(i) < today()) n++;
    return n;
  };

  const loanState = async (id: string) => {
    const d = await getLoanDetail(userId, id);
    const future = d.schedule.filter((r) => r.status !== "PAID");
    return {
      loan: d.loan,
      paidRows: d.schedule.filter((r) => r.status === "PAID").length,
      totalRows: d.schedule.length,
      payments: d.payments,
      futurePrincipal: sum(future.map((r) => r.principalComponent)),
    };
  };

  it("EMIs already paid: marks them paid without touching the bank or the ledger", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "10", repaymentAccountId: bankId }), meta);
    const s = await loanState(loan.id);
    expect(s.paidRows).toBe(10);
    expect(s.payments.every((p) => p.isOpening && p.transactionId === null)).toBe(true);
    expect(s.loan.principalPaid.plus(s.loan.outstandingPrincipal).toString()).toBe("500000");
    // The remaining schedule repays exactly the outstanding.
    expect(s.futurePrincipal.toFixed(2)).toBe(s.loan.outstandingPrincipal.toFixed(2));
    expect(s.totalRows).toBe(60);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toString()).toBe("200000");
    // Total paid till date = 10 EMIs
    expect(sum(s.payments.map((p) => p.amount)).toFixed(2)).toBe(s.loan.emiAmount.times(10).toFixed(2));
  });

  it("lender outstanding lower than the schedule: extra shows as a part-prepayment and the tenure shortens", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "10", outstandingAsPerBank: "380000" }), meta);
    const s = await loanState(loan.id);
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("380000.00");
    expect(s.payments.filter((p) => p.paymentType === "PREPAYMENT")).toHaveLength(1);
    expect(s.futurePrincipal.toFixed(2)).toBe("380000.00");
    expect(s.totalRows).toBeLessThan(60);
  });

  it("lender outstanding higher than the schedule: principal is scaled down, the rest counts as interest", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "10", outstandingAsPerBank: "450000" }), meta);
    const s = await loanState(loan.id);
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("450000.00");
    expect(s.loan.principalPaid.toFixed(2)).toBe("50000.00");
    expect(s.payments.filter((p) => p.paymentType === "PREPAYMENT")).toHaveLength(0);
    // Each opening EMI still equals the EMI; interest = EMI − principal
    for (const p of s.payments) expect(p.principalComponent.plus(p.interestComponent).toFixed(2)).toBe(p.amount.toFixed(2));
    expect(s.futurePrincipal.toFixed(2)).toBe("450000.00");
  });

  it("only the outstanding known: 0 EMIs + lender outstanding", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "0", outstandingAsPerBank: "420000" }), meta);
    const s = await loanState(loan.id);
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("420000.00");
    expect(s.paidRows).toBe(0);
  });

  it("update progress later replaces the earlier entry; 0 resets the loan", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "5" }), meta);
    await setLoanProgress(userId, loan.id, { emisPaid: 12, outstandingAsPerBank: "400000" }, meta);
    let s = await loanState(loan.id);
    expect(s.paidRows).toBe(12);
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("400000.00");
    expect(s.payments.filter((p) => p.paymentType === "EMI")).toHaveLength(12);

    await setLoanProgress(userId, loan.id, { emisPaid: 0, outstandingAsPerBank: "" }, meta);
    s = await loanState(loan.id);
    expect(s.paidRows).toBe(0);
    expect(s.payments).toHaveLength(0);
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("500000.00");
    expect(s.totalRows).toBe(60);
  });

  it("paying everything closes the loan", async () => {
    const loan = await createLoan(userId, baseLoan({ emisPaid: "10", outstandingAsPerBank: "0" }), meta);
    const s = await loanState(loan.id);
    expect(s.loan.status).toBe("CLOSED");
    expect(s.loan.outstandingPrincipal.toFixed(2)).toBe("0.00");
  });

  it("works alongside payments recorded in FinSight360", async () => {
    const due = dueBeforeToday();
    const loan = await createLoan(userId, baseLoan({ emisPaid: "13" }), meta);
    const emi = (await loanState(loan.id)).loan.emiAmount;
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: iso(today()), amount: emi.toFixed(2), account: `bank:${bankId}` }, meta);
    let s = await loanState(loan.id);
    expect(s.paidRows).toBe(14);
    // EMI #14 is recorded here, so at most 13 can be "before FinSight360"
    await expect(setLoanProgress(userId, loan.id, { emisPaid: 14 }, meta)).rejects.toMatchObject({ code: "TOO_MANY_EMIS" });
    await expect(setLoanProgress(userId, loan.id, { emisPaid: 13, outstandingAsPerBank: "300000" }, meta)).rejects.toMatchObject({ code: "PAYMENTS_RECORDED" });
    await setLoanProgress(userId, loan.id, { emisPaid: 11 }, meta);
    s = await loanState(loan.id);
    // 11 opening + recorded #14; #12, #13 and any later EMI already due are overdue
    expect(s.paidRows).toBe(12);
    expect(s.payments.filter((p) => !p.isOpening)).toHaveLength(1);
    expect(s.loan.principalPaid.plus(s.loan.outstandingPrincipal).toString()).toBe("500000");
    const overdue = (await getReminderItems(userId)).filter((i) => i.source === "EMI" && i.status === "OVERDUE");
    expect(overdue.length).toBe(2 + Math.max(0, due - 14));
    // The recorded EMI is still in the ledger and the bank
    expect(await prisma.transaction.count({ where: { userId, transactionType: "EMI", deletedAt: null } })).toBe(1);
  });

  it("rejects bad input and other users", async () => {
    await expect(createLoan(userId, baseLoan({ emisPaid: "61" }), meta)).rejects.toMatchObject({ code: "TOO_MANY_EMIS" });
    await expect(createLoan(userId, baseLoan({ emisPaid: "2.5" }), meta)).rejects.toBeTruthy();
    await expect(createLoan(userId, baseLoan({ outstandingAsPerBank: "600000" }), meta)).rejects.toMatchObject({ code: "INVALID_OUTSTANDING" });
    const loan = await createLoan(userId, baseLoan(), meta);
    await expect(setLoanProgress(userId, loan.id, { emisPaid: -1 }, meta)).rejects.toBeTruthy();
    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    await expect(setLoanProgress(other, loan.id, { emisPaid: 3 }, meta)).rejects.toMatchObject({ status: 404 });
    // nothing changed
    expect((await loanState(loan.id)).paidRows).toBe(0); // no history given
  });

  it("the old 'mark past EMIs as paid' path still works and is marked as before-FinSight360", async () => {
    const loan = await createLoan(userId, baseLoan({ markPastAsPaid: true }), meta);
    const s = await loanState(loan.id);
    expect(s.paidRows).toBe(dueBeforeToday());
    expect(s.payments.every((p) => p.isOpening)).toBe(true);
    const fresh = await createLoan(userId, baseLoan({ name: "No history", markPastAsPaid: false }), meta);
    expect((await loanState(fresh.id)).paidRows).toBe(0);
  });

  // ───────────────────────────── credit cards ─────────────────────────────

  const cardInput = (extra: Record<string, unknown> = {}) => ({
    bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "200000", currentOutstanding: "30000",
    totalAmountDue: "12000", minimumAmountDue: "600", currentDueDate: iso(addDays(today(), 6)), ...extra,
  });
  const cardRow = async (id: string) => (await getCreditCardOverview(userId)).cards.find((c) => c.id === id)!;

  it("card: already paid on this bill reduces the remaining due, not the outstanding or the bank", async () => {
    const card = await createCreditCard(userId, cardInput({ paidOnBill: "5000" }), meta);
    let c = await cardRow(card.id);
    expect(c.remainingDue.toFixed(2)).toBe("7000.00");
    expect(c.remainingMinimum.toFixed(2)).toBe("0.00");
    expect(c.currentOutstanding.toFixed(2)).toBe("30000.00");
    expect(c.paidThisCycle.toFixed(2)).toBe("5000.00");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toString()).toBe("200000");
    // Reminder shows only what is left
    expect((await getReminderItems(userId)).find((i) => i.source === "CARD")?.amount?.toFixed(2)).toBe("7000.00");

    // Paid in full → no reminder
    await updateCreditCard(userId, card.id, cardInput({ paidOnBill: "12000" }), meta);
    c = await cardRow(card.id);
    expect(c.remainingDue.toFixed(2)).toBe("0.00");
    expect((await getReminderItems(userId)).some((i) => i.source === "CARD")).toBe(false);

    // A recorded payment adds to it
    await updateCreditCard(userId, card.id, cardInput({ paidOnBill: "2000" }), meta);
    await prisma.creditCard.update({ where: { id: card.id }, data: { lastStatementDate: addDays(today(), -14) } });
    const { createTransaction } = await import("@/services/transaction.service");
    await createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: iso(today()), amount: "3000", account: `bank:${bankId}`, creditCardId: card.id, description: "Card bill" }, meta);
    c = await cardRow(card.id);
    expect(c.paidThisCycle.toFixed(2)).toBe("5000.00");
    expect(c.remainingDue.toFixed(2)).toBe("7000.00");
  });

  it("card: a new bill resets 'already paid' unless it was changed in the same edit; can't exceed the bill", async () => {
    const card = await createCreditCard(userId, cardInput({ paidOnBill: "5000" }), meta);
    await expect(updateCreditCard(userId, card.id, cardInput({ paidOnBill: "13000" }), meta)).rejects.toMatchObject({ fieldErrors: { paidOnBill: ["Can't be more than the total due"] } });
    // same due date → kept
    await updateCreditCard(userId, card.id, cardInput({ paidOnBill: "5000", currentOutstanding: "28000" }), meta);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: card.id } })).paidOnBill.toFixed(2)).toBe("5000.00");
    // new statement (new due date), user didn't touch the field → reset to 0
    const nextBill = cardInput({ totalAmountDue: "9000", currentDueDate: iso(addDays(today(), 36)), paidOnBill: "5000" });
    await updateCreditCard(userId, card.id, nextBill, meta);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: card.id } })).paidOnBill.toFixed(2)).toBe("0.00");
    // new statement and the user entered a new amount → kept
    await updateCreditCard(userId, card.id, cardInput({ totalAmountDue: "8000", currentDueDate: iso(addDays(today(), 66)), paidOnBill: "1500" }), meta);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: card.id } })).paidOnBill.toFixed(2)).toBe("1500.00");
  });
});
