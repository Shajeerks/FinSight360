import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createLoan } from "@/services/loan.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { applyMapping, commitImport, createImport } from "@/services/import.service";
import { autoLinkLoanPayments, findLoanPaymentCandidates, getLoanLinkOptions, linkTransactionToLoan } from "@/services/loan-match.service";
import { meta, resetDatabase } from "./helpers";

describe("Linking bank payments to loans (integration)", () => {
  let userId: string;
  let bankId: string;
  let loanId: string;
  let emi: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "lm@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "SBI", nickname: "SBI", accountType: "SAVINGS", last4: "8924", currentBalance: "100000" }, meta)).id;
    const loan = await createLoan(userId, { name: "Personal Loan", lender: "Indusind Bank", loanType: "PERSONAL", principal: "200000", interestRate: "14.5", startDate: "2026-06-15", firstEmiDate: "2026-07-04", tenureMonths: 36 }, meta);
    loanId = loan.id;
    emi = loan.emiAmount.toFixed(2);
  });
  afterAll(() => prisma.$disconnect());

  const schedule = () => prisma.loanAmortizationSchedule.findMany({ where: { loanId }, orderBy: { installmentNumber: "asc" }, take: 3 });

  it("a bank statement import links the clear EMI debits to the loan automatically, in instalment order", async () => {
    const csv = Buffer.from(
      ["Date,Description,Debit,Credit,Balance", `04/07/2026,NACH00000000022163 BD- IndusindBan,${emi},,90000.00`, "05/07/2026,UPI/DR/SWIGGY,450.00,,89550.00", `04/08/2026,NACH00000000022163 BD- IndusindBan,${emi},,80000.00`].join("\n"),
    );
    const up = await createImport(userId, { file: { name: "sbi.csv", type: "text/csv", buffer: csv }, account: `bank:${bankId}` }, meta);
    const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: up.id } });
    const m = imp.columnMapping as { fields: Record<string, number>; positiveIs: string };
    await applyMapping(userId, up.id, { headerRowIndex: imp.headerRowIndex, dateFormat: imp.dateFormat, amountMode: imp.amountMode, positiveIs: m.positiveIs, ...m.fields }, meta);
    const s = await commitImport(userId, up.id, meta);
    expect(s.loanPaymentsLinked).toBe(2);
    const rows = await schedule();
    expect(rows.map((r) => r.status)).toEqual(["PAID", "PAID", "UPCOMING"]);
    const pays = await prisma.loanPayment.findMany({ where: { loanId, deletedAt: null }, orderBy: { paymentDate: "asc" } });
    expect(pays.map((p) => p.paymentDate.toISOString().slice(0, 10))).toEqual(["2026-07-04", "2026-08-04"]);
    expect(pays.every((p) => p.transactionId)).toBe(true);
    // No extra ledger rows: the bank balance is the statement's.
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(3);
    expect(await findLoanPaymentCandidates(userId)).toHaveLength(0);
  });

  it("a payment without the lender's name is suggested; linking it by hand to a chosen instalment works once", async () => {
    const t = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-07-05", amount: emi, account: `bank:${bankId}`, description: "ICIC00261000001992 TP EMANDATE CA" }, meta);
    const c = await findLoanPaymentCandidates(userId);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ transactionId: t.id, loanId, confident: false });
    expect((await autoLinkLoanPayments(userId)).linked).toBe(0); // not sure enough to do it alone

    const opts = await getLoanLinkOptions(userId);
    const second = opts[0].instalments[1].id;
    await linkTransactionToLoan(userId, { transactionId: t.id, loanId, scheduleId: second }, meta);
    const rows = await schedule();
    expect(rows.map((r) => r.status)).toEqual(["UPCOMING", "PAID", "UPCOMING"]);
    await expect(linkTransactionToLoan(userId, { transactionId: t.id, loanId }, meta)).rejects.toMatchObject({ code: "ALREADY_LINKED" });
    expect(await findLoanPaymentCandidates(userId)).toHaveLength(0);
  });

  it("another user can't link your transaction", async () => {
    const t = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-07-05", amount: emi, account: `bank:${bankId}`, description: "NACH IndusindBan" }, meta);
    const other = (await prisma.user.create({ data: { email: "x@example.com" } })).id;
    await expect(linkTransactionToLoan(other, { transactionId: t.id, loanId }, meta)).rejects.toMatchObject({ status: 404 });
  });
});
