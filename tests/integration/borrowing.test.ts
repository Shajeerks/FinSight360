import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createTransaction, getTransaction, toFormValues, updateTransaction } from "@/services/transaction.service";
import { monthSummary } from "@/services/dashboard.service";
import { getIncomeOverview } from "@/services/income-expense.service";
import { buildReport } from "@/services/report.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { commitImport, createImport, getImport, updateImportRow } from "@/services/import.service";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

const ym = { year: 2026, month: 10 };

describe("Loans & borrowing transactions (integration)", () => {
  let userId: string;
  let bankId: string;
  let cardId: string;
  beforeEach(async () => {
    await resetDatabase();
    for (const c of DEFAULT_CATEGORIES) {
      const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
      if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
    }
    userId = (await prisma.user.create({ data: { email: "b@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC", nickname: "Salary", accountType: "SALARY", currentBalance: "10000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "ICICI", cardName: "Amazon Pay", last4: "6634", creditLimit: "100000", currentOutstanding: "2000" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  const bank = async () => (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2);
  const card = async () => (await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).currentOutstanding.toFixed(2);

  it("a loan received and money lent move the balance but not income / expenses", async () => {
    await createTransaction(userId, { kind: "INCOME", transactionDate: "2026-10-01", amount: "85000", account: `bank:${bankId}`, description: "Salary", incomeCategory: "SALARY" }, meta);
    const loan = await createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-10-03", amount: "200000", account: `bank:${bankId}`, description: "Personal loan disbursal - Bajaj" }, meta);
    await createTransaction(userId, { kind: "LENT", transactionDate: "2026-10-05", amount: "5000", account: `bank:${bankId}`, description: "Lent to Ravi" }, meta);
    expect(await bank()).toBe("290000.00");

    const s = await monthSummary(userId, ym);
    expect(s.income.toString()).toBe("85000");
    expect(s.expenses.toString()).toBe("0");
    expect(s.borrowed.toString()).toBe("200000");
    expect(s.lentOrRepaid.toString()).toBe("5000");

    const inc = await getIncomeOverview(userId, ym);
    expect(inc.total.toString()).toBe("85000");
    expect(inc.borrowed.toString()).toBe("200000");
    expect(inc.list.rows.map((r) => r.description)).toEqual(["Salary"]);

    const rep = await buildReport(userId, { type: "income", from: "2026-10-01", to: "2026-10-31" });
    expect(JSON.stringify(rep)).not.toContain("Bajaj");

    // default category: Loans & Borrowing; no income detail row
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: loan.id }, include: { category: true, income: true } });
    expect(t.category?.name).toBe("Loans & Borrowing");
    expect(t.income).toBeNull();
  });

  it("money taken from a credit card raises its outstanding and lands in the bank", async () => {
    const t = await createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-10-04", amount: "15000", account: `bank:${bankId}`, creditCardId: cardId, description: "Card to bank transfer" }, meta);
    expect(await bank()).toBe("25000.00");
    expect(await card()).toBe("17000.00");
    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: t.id }, include: { subCategory: true } });
    expect(row.subCategory?.name).toBe("Credit card to bank / cash");
    // edit form shows the bank as the account and the card as the source
    const f = toFormValues(await getTransaction(userId, t.id));
    expect(f).toMatchObject({ kind: "BORROWED", account: `bank:${bankId}`, creditCardId: cardId });
    // remove the card link → card back to normal
    await updateTransaction(userId, t.id, { ...f, creditCardId: "" }, meta);
    expect(await card()).toBe("2000.00");
    expect(await bank()).toBe("25000.00");
    // the card report shows it as cash taken, not a refund
    await updateTransaction(userId, t.id, { ...f }, meta);
    const rep = await buildReport(userId, { type: "cards", from: "2026-10-01", to: "2026-10-31" });
    expect(rep.rows[0]).toMatchObject({ cashTaken: "15000.00", refunds: "0.00" });
  });

  it("an income entry can be corrected to a borrowing (and back)", async () => {
    const t = await createTransaction(userId, { kind: "INCOME", transactionDate: "2026-10-06", amount: "20000", account: `bank:${bankId}`, description: "UPI from Arun", incomeCategory: "OTHER" }, meta);
    expect((await monthSummary(userId, ym)).income.toString()).toBe("20000");
    const f = toFormValues(await getTransaction(userId, t.id));
    await updateTransaction(userId, t.id, { ...f, kind: "BORROWED", categoryId: "", subCategoryId: "", incomeCategory: null }, meta);
    const s = await monthSummary(userId, ym);
    expect(s.income.toString()).toBe("0");
    expect(s.borrowed.toString()).toBe("20000");
    expect(await prisma.income.count({ where: { transactionId: t.id } })).toBe(0);
    expect(await bank()).toBe("30000.00");
  });

  it("rejects someone else's card and income categories on a borrowing", async () => {
    const other = (await prisma.user.create({ data: { email: "o@example.com" } })).id;
    const otherCard = (await createCreditCard(other, { bankName: "SBI", cardName: "X", last4: "1111", creditLimit: "1000", currentOutstanding: "0" }, meta)).id;
    await expect(createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-10-04", amount: "100", account: `bank:${bankId}`, creditCardId: otherCard, description: "x" }, meta)).rejects.toBeTruthy();
    const salary = await prisma.category.findFirstOrThrow({ where: { name: "Salary", userId: null } });
    await expect(createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-10-04", amount: "100", account: `bank:${bankId}`, categoryId: salary.id, description: "x" }, meta)).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    // a card can't be the account for a borrowing
    await expect(createTransaction(userId, { kind: "BORROWED", transactionDate: "2026-10-04", amount: "100", account: `card:${cardId}`, description: "x" }, meta)).rejects.toBeTruthy();
    expect(await bank()).toBe("10000.00");
    expect(await card()).toBe("2000.00");
  });

  it("statement import: a money-in row can be marked as a borrowing before importing", async () => {
    const buffer = readFileSync(path.join(__dirname, "..", "fixtures", "kotak-style-statement.pdf"));
    const up = await createImport(userId, { file: { name: "k.pdf", type: "application/pdf", buffer }, account: `bank:${bankId}` }, meta);
    const d = await getImport(userId, up.id);
    const salary = d.rows.find((r) => r.description?.includes("ACME SALARY"))!;
    const debit = d.rows.find((r) => r.direction === "DEBIT")!;
    await updateImportRow(userId, up.id, salary.id, { transactionType: "BORROWING" });
    await updateImportRow(userId, up.id, debit.id, { transactionType: "BORROWING" }); // money out → "lent / repaid"
    await commitImport(userId, up.id, meta);
    const s = await monthSummary(userId, ym);
    expect(s.income.toString()).toBe("6000"); // only the FD sweep-in row is left as income
    expect(s.borrowed.toString()).toBe("1000");
    expect(s.lentOrRepaid.toString()).toBe(debit.amount!.toString());
    const row = await prisma.transaction.findFirstOrThrow({ where: { userId, description: { contains: "ACME SALARY" } }, include: { category: true } });
    expect(row).toMatchObject({ transactionType: "BORROWING", direction: "CREDIT" });
    expect(row.category?.name).toBe("Loans & Borrowing");
  });
});
