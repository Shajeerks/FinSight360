import { afterAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { commitImport, createImport, undoImport } from "@/services/import.service";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createLoan, deleteLoanPayment } from "@/services/loan.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import {
  applyEmiToLoan,
  applyMatchedEmis,
  buildDebtTracker,
  commitDebtExcel,
  createDebtLender,
  getDebtTrackerMonth,
  previewDebtExcel,
  saveCardBill,
  saveDebtEntry,
  undoDebtExcel,
} from "@/services/debt-tracker.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

const fixed = (v: { toFixed: (n: number) => string }) => v.toFixed(2);

describe("Debt tracker (integration)", () => {
  let userId: string;
  let bankId: string;
  let cardId: string;

  beforeEach(async () => {
    await resetDatabase();
    for (const c of DEFAULT_CATEGORIES) {
      const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
      if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
    }
    userId = (await prisma.user.create({ data: { email: "debt@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC", nickname: "Salary", accountType: "SALARY", currentBalance: "500000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "ICICI", cardName: "Amazon Pay", last4: "6634", creditLimit: "100000", currentOutstanding: "0" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  const lender = async (key: string) => (await buildDebtTracker(userId)).lenders.find((l) => l.key === key)!;
  const month = (l: Awaited<ReturnType<typeof lender>>, m: string) => l.months.find((r) => r.month === m)!;

  it("credit card: spends, charges and bill payments per month; an entered statement balance makes interest the balancing figure", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-08-05", amount: "10000", account: `card:${cardId}`, description: "Amazon" }, meta);
    await createTransaction(userId, { kind: "FEE", transactionDate: "2026-08-20", amount: "500", account: `card:${cardId}`, description: "Late payment fee" }, meta);
    await createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: "2026-09-03", amount: "8000", account: `bank:${bankId}`, creditCardId: cardId, description: "ICICI card bill" }, meta);

    let card = await lender(`card:${cardId}`);
    let aug = month(card, "2026-08");
    expect([aug.opening, aug.newBorrowing, aug.payment, aug.interest, aug.closing].map(fixed)).toEqual(["0.00", "10000.00", "0.00", "500.00", "10500.00"]);
    let sep = month(card, "2026-09");
    expect([sep.opening, sep.payment, sep.paidToDate, sep.closing, sep.changeFromLastMonth].map(fixed)).toEqual(["10500.00", "8000.00", "8000.00", "2500.00", "-8000.00"]);
    // Same as the card's own outstanding
    expect(fixed(month(card, "2026-10").closing)).toBe(fixed((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).currentOutstanding));

    // The statement says ₹2,900: the extra ₹400 is interest; October starts from ₹2,900.
    await saveDebtEntry(userId, { month: "2026-09", lenderKey: `card:${cardId}`, closingOutstanding: "2900" }, meta);
    card = await lender(`card:${cardId}`);
    sep = month(card, "2026-09");
    expect(fixed(sep.interest)).toBe("400.00");
    expect(sep.entered).toContain("closing");
    expect(fixed(month(card, "2026-10").opening)).toBe("2900.00");

    // Clearing every field (as the form sends them: empty strings) removes the entry again
    await saveDebtEntry(userId, { month: "2026-09", lenderKey: `card:${cardId}`, openingOutstanding: "", newBorrowing: "", payment: "", paidToDate: "", interest: "", closingOutstanding: "", remainingEmis: "" }, meta);
    expect(await prisma.debtMonthEntry.count()).toBe(0);
    aug = month(await lender(`card:${cardId}`), "2026-08");
    expect(fixed(aug.closing)).toBe("10500.00");
  });

  it("loan: EMI debits from the bank statement are found, estimated, then applied to the loan; undo keeps the bank transaction", async () => {
    const loan = await createLoan(userId, { name: "Personal loan", lender: "Bajaj Finance", loanType: "PERSONAL", principal: "100000", interestRate: "12", startDate: "2026-07-01", firstEmiDate: "2026-08-05", tenureMonths: 12 }, meta);
    const emi = loan.emiAmount.toFixed(2);
    // As imported from a bank statement: an EMI debit that isn't linked to the loan.
    const debit = await createTransaction(userId, { kind: "EMI", transactionDate: "2026-08-05", amount: emi, account: `bank:${bankId}`, description: "ACH D- BAJAJ FINANCE LTD EMI" }, meta);
    // A look-alike debit that is NOT this loan's EMI
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-08-06", amount: emi, account: `bank:${bankId}`, description: "Furniture" }, meta);

    let l = await lender(`loan:${loan.id}`);
    const jul = month(l, "2026-07");
    expect([jul.newBorrowing, jul.closing].map(fixed)).toEqual(["100000.00", "100000.00"]);
    let aug = month(l, "2026-08");
    expect(l.pendingEmis.get("2026-08")?.map((e) => e.transactionId)).toEqual([debit.id]);
    expect(fixed(aug.payment)).toBe(emi);
    expect(fixed(aug.interest)).toBe("1000.00"); // 1% of ₹1,00,000
    expect(fixed(aug.closing)).toBe((100000 - Number(emi) + 1000).toFixed(2));
    expect(aug.remainingEmis).toBe(11);
    // September EMI not paid yet: interest still accrues
    const sep = month(l, "2026-09");
    expect(fixed(sep.payment)).toBe("0.00");
    expect(fixed(sep.interest)).toBe(aug.closing.times(0.01).toDecimalPlaces(2).toFixed(2));

    await applyEmiToLoan(userId, { loanId: loan.id, transactionId: debit.id }, meta);
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: debit.id }, include: { category: true, loanPayment: true } });
    expect(t.loanId).toBe(loan.id);
    expect(t.category?.name).toBe("EMI");
    expect(t.loanPayment?.linkedExisting).toBe(true);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(2); // nothing new in the ledger
    l = await lender(`loan:${loan.id}`);
    aug = month(l, "2026-08");
    expect(l.pendingEmis.get("2026-08") ?? []).toEqual([]);
    expect(fixed(aug.interest)).toBe("1000.00");
    expect(fixed(aug.closing)).toBe((100000 - Number(emi) + 1000).toFixed(2));
    expect(fixed((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).interestPaid)).toBe("1000.00");

    // Applying twice is refused
    await expect(applyEmiToLoan(userId, { loanId: loan.id, transactionId: debit.id }, meta)).rejects.toMatchObject({ code: "ALREADY_LINKED" });

    // Undo the payment: the statement row stays, just unlinked
    await deleteLoanPayment(userId, loan.id, t.loanPayment!.id, meta);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: debit.id } });
    expect(after.deletedAt).toBeNull();
    expect(after.loanId).toBeNull();
    expect((await lender(`loan:${loan.id}`)).pendingEmis.get("2026-08")?.length).toBe(1);

    // "Apply all" for the month
    const res = await applyMatchedEmis(userId, "2026-08", meta);
    expect(res).toEqual({ applied: 1, failed: [] });
  });

  it("other lender (a person): borrowed and repaid via Loan / borrowing transactions, with monthly interest", async () => {
    const ravi = await createDebtLender(userId, { name: "Ravi", monthlyRatePct: 1, openingDate: "2026-08-01" }, meta);
    await createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-08-10", amount: "50000", account: `bank:${bankId}`, description: "UPI from RAVI KUMAR" }, meta);
    await createTransaction(userId, { kind: "LENT", transactionDate: "2026-09-15", amount: "10000", account: `bank:${bankId}`, description: "UPI to Ravi kumar" }, meta);
    await createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-09-16", amount: "7000", account: `bank:${bankId}`, description: "From Suresh" }, meta);

    const l = await lender(`lender:${ravi.id}`);
    const aug = month(l, "2026-08");
    expect([aug.opening, aug.newBorrowing, aug.interest, aug.closing].map(fixed)).toEqual(["0.00", "50000.00", "0.00", "50000.00"]);
    const sep = month(l, "2026-09");
    expect([sep.payment, sep.interest, sep.closing].map(fixed)).toEqual(["10000.00", "500.00", "40500.00"]);
  });

  it("monthly sheet: totals across lenders, financial-year interest, month picker", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-05", amount: "4000", account: `card:${cardId}`, description: "Flipkart" }, meta);
    await createTransaction(userId, { kind: "FEE", transactionDate: "2026-09-25", amount: "120", account: `card:${cardId}`, description: "Finance charges" }, meta);
    const ravi = await createDebtLender(userId, { name: "Ravi", openingOutstanding: "20000", openingDate: "2026-09-01" }, meta);
    const m = await getDebtTrackerMonth(userId, "2026-09");
    expect(m.month).toBe("2026-09");
    expect(m.rows.map((r) => r.key).sort()).toEqual([`card:${cardId}`, `lender:${ravi.id}`].sort());
    expect(fixed(m.totals.closing)).toBe("24120.00");
    expect(fixed(m.totals.interest)).toBe("120.00");
    expect(m.fy.label).toBe("FY 2026-27");
    expect(fixed(m.fy.interest)).toBe("120.00");
    expect(m.months[0]).toBe(m.current);
    // A month in the future is clamped to the current month
    expect((await getDebtTrackerMonth(userId, "2099-01")).month).toBe(m.current);
  });

  it("Excel history: reads the monthly sheets, suggests lenders, imports as entered figures, and can be undone", async () => {
    const loan = await createLoan(userId, { name: "Personal loan", lender: "Bajaj Finance", loanType: "PERSONAL", principal: "100000", interestRate: "12", startDate: "2026-07-01", firstEmiDate: "2026-08-05", tenureMonths: 12 }, meta);
    const wb = new ExcelJS.Workbook();
    for (const [name, rows] of [
      ["Aug 2026", [[1, "Bajaj Finance", 100000, 8885, 8885, 92200, 1085, 11, -7800], [2, "ICICI Amazon", 12000, 12000, 12000, 3000, 0, null, -9000], [3, "Hand loan - Ammu", 25000, 0, 0, 25000, 0, null, 0], [null, "Total", 137000, 20885, 20885, 120200, 1085, null, null]]],
      ["Sep 2026", [[1, "Bajaj Finance", 92200, 8885, 17770, 84237.5, 922.5, 10, -7962.5]]],
    ] as const) {
      const ws = wb.addWorksheet(name);
      ws.addRow(["Debt summary"]);
      ws.addRow(["SI#", "Lender name", "Total outstanding", "Current month payment", "Paid by this month", "Remaining balance", "Interest charged by current month", "Remaining EMI count", "Different from last month outstanding"]);
      for (const r of rows) ws.addRow([...r]);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const p = await previewDebtExcel(userId, buf);
    expect(p.rows).toHaveLength(4);
    expect(p.lenders).toEqual(["Bajaj Finance", "Hand loan - Ammu", "ICICI Amazon"]);
    expect(p.suggestions["Bajaj Finance"]).toBe(`loan:${loan.id}`);
    expect(p.suggestions["ICICI Amazon"]).toBe(`card:${cardId}`);
    expect(p.suggestions["Hand loan - Ammu"]).toBe("new");

    const r = await commitDebtExcel(userId, { rows: p.rows, mapping: p.suggestions }, meta);
    expect(r).toEqual({ saved: 4, skipped: 0, kept: 0, lendersCreated: 1 });

    const l = await lender(`loan:${loan.id}`);
    const sep = month(l, "2026-09");
    expect([sep.opening, sep.closing, sep.interest, sep.paidToDate].map(fixed)).toEqual(["92200.00", "84237.50", "922.50", "17770.00"]);
    expect(sep.remainingEmis).toBe(10);
    // October chains from the Excel closing
    expect(fixed(month(l, "2026-10").opening)).toBe("84237.50");
    const ammu = (await buildDebtTracker(userId)).lenders.find((x) => x.name === "Hand loan - Ammu")!;
    expect(fixed(month(ammu, "2026-10").opening)).toBe("25000.00");

    // Importing again without "replace" keeps what's there
    expect(await commitDebtExcel(userId, { rows: p.rows, mapping: { ...p.suggestions, "Hand loan - Ammu": "skip" } }, meta)).toEqual({ saved: 0, skipped: 1, kept: 3, lendersCreated: 0 });
    expect(await undoDebtExcel(userId, meta)).toBe(4);
  });

  it("card statement PDF: bill read on upload → due date, total due as remaining balance, interest as the balancing figure; undo restores the card", async () => {
    const card2 = (await createCreditCard(userId, { bankName: "Sample Bank", cardName: "Rewards", last4: "6634", creditLimit: "50000", currentOutstanding: "3000" }, meta)).id;
    const pdf = readFileSync(path.join(__dirname, "..", "fixtures", "card-statement.pdf"));
    const up = await createImport(userId, { file: { name: "card.pdf", type: "application/pdf", buffer: pdf }, account: `card:${card2}` }, meta);
    const s = await commitImport(userId, up.id, meta);
    expect(s.created).toBe(4); // the bill-summary row is not a transaction
    expect(s.cardBill).toMatchObject({ statementDate: "2026-10-05", dueDate: "2026-10-25", totalDue: "4436.00", minimumDue: "230.00", appliedToCard: true });
    let c = await prisma.creditCard.findUniqueOrThrow({ where: { id: card2 } });
    expect([c.lastStatementDate?.toISOString().slice(0, 10), c.currentDueDate?.toISOString().slice(0, 10), fixed(c.totalAmountDue), fixed(c.minimumAmountDue)]).toEqual(["2026-10-05", "2026-10-25", "4436.00", "230.00"]);

    let l = await lender(`card:${card2}`);
    const sep = month(l, "2026-09");
    expect([sep.opening, sep.newBorrowing, sep.payment, sep.closing].map(fixed)).toEqual(["3000.00", "4300.00", "3000.00", "4300.00"]);
    const oct = month(l, "2026-10");
    expect([oct.closing, oct.interest].map(fixed)).toEqual(["4436.00", "136.00"]); // cycle 1–5 Oct ends on the bill
    const due = l.dues.get("2026-10")!;
    expect([due.dueDate?.toISOString().slice(0, 10), fixed(due.amountDue!), due.status]).toEqual(["2026-10-25", "4436.00", "OVERDUE"]);

    // Paying the bill on 20 Oct: the October due shows as paid; the payment is in the next cycle.
    await createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: "2026-10-20", amount: "4436", account: `bank:${bankId}`, creditCardId: card2, description: "Card bill" }, meta);
    l = await lender(`card:${card2}`);
    expect(l.dues.get("2026-10")!.status).toBe("PAID");
    expect(fixed(month(l, "2026-11").payment)).toBe("4436.00");
    expect(fixed(month(l, "2026-11").closing)).toBe("0.00");

    const sheet = await getDebtTrackerMonth(userId, "2026-10");
    const row = sheet.rows.find((r) => r.key === `card:${card2}`)!;
    expect(row.bill?.source).toBe("upload");
    expect(row.due?.status).toBe("PAID");

    await undoImport(userId, up.id, meta);
    c = await prisma.creditCard.findUniqueOrThrow({ where: { id: card2 } });
    expect([c.lastStatementDate, fixed(c.totalAmountDue)]).toEqual([null, "0.00"]);
  });

  it("card bill typed in the tracker: becomes the month's remaining balance and the card's latest bill; clearing it removes it", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-10", amount: "2000", account: `card:${cardId}`, description: "Shopping" }, meta);
    await saveCardBill(userId, { cardId, month: "2026-09", statementDate: "2026-09-15", dueDate: "2026-10-05", totalDue: "2050", minimumDue: "100" }, meta);
    let l = await lender(`card:${cardId}`);
    const sep = month(l, "2026-09");
    expect([sep.newBorrowing, sep.interest, sep.closing].map(fixed)).toEqual(["2000.00", "50.00", "2050.00"]);
    expect(l.dues.get("2026-10")!.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(fixed((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).totalAmountDue)).toBe("2050.00");
    await expect(saveCardBill(userId, { cardId, month: "2026-09", statementDate: "2026-08-15", totalDue: "1" }, meta)).rejects.toMatchObject({ code: "WRONG_MONTH" });
    await expect(saveCardBill(userId, { cardId, month: "2026-09", statementDate: "2026-09-15", totalDue: "100", minimumDue: "500" }, meta)).rejects.toBeTruthy();

    await saveCardBill(userId, { cardId, month: "2026-09", totalDue: "" }, meta);
    l = await lender(`card:${cardId}`);
    expect(fixed(month(l, "2026-09").closing)).toBe("2000.00");
    expect(await prisma.statement.count({ where: { creditCardId: cardId, deletedAt: null } })).toBe(0);
  });

  it("due dates: EMI date from the loan schedule with paid / overdue status; a date you enter for a person", async () => {
    const loan = await createLoan(userId, { name: "Personal loan", lender: "Bajaj Finance", loanType: "PERSONAL", principal: "100000", interestRate: "12", startDate: "2026-07-01", firstEmiDate: "2026-08-05", tenureMonths: 12 }, meta);
    await createTransaction(userId, { kind: "EMI", transactionDate: "2026-08-05", amount: loan.emiAmount.toFixed(2), account: `bank:${bankId}`, description: "BAJAJ FINANCE EMI" }, meta);
    const l = await lender(`loan:${loan.id}`);
    expect([l.dues.get("2026-08")!.dueDate?.toISOString().slice(0, 10), l.dues.get("2026-08")!.status]).toEqual(["2026-08-05", "PAID"]);
    expect(l.dues.get("2026-09")!.status).toBe("OVERDUE");

    const ravi = await createDebtLender(userId, { name: "Ravi", openingOutstanding: "10000", openingDate: "2026-09-01" }, meta);
    await saveDebtEntry(userId, { month: "2026-10", lenderKey: `lender:${ravi.id}`, dueDate: "2026-10-30" }, meta);
    const r = await lender(`lender:${ravi.id}`);
    expect([r.dues.get("2026-10")!.dueDate?.toISOString().slice(0, 10), r.dues.get("2026-10")!.source, r.dues.get("2026-10")!.status]).toEqual(["2026-10-30", "entered", "OVERDUE"]);
  });

  it("another user can't see or edit your lenders", async () => {
    const other = (await prisma.user.create({ data: { email: "x@example.com" } })).id;
    await expect(saveDebtEntry(other, { month: "2026-09", lenderKey: `card:${cardId}`, payment: "5" }, meta)).rejects.toMatchObject({ status: 404 });
    expect((await buildDebtTracker(other)).lenders).toEqual([]);
  });
});
