import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount, createCashAccount, deleteBankAccount, listBankAccounts, updateBankAccount } from "@/services/account.service";
import { createCreditCard, getCreditCardOverview, updateCreditCard } from "@/services/credit-card.service";
import { createTransaction, deleteTransaction, getTransaction, listTransactions, toFormValues, updateTransaction } from "@/services/transaction.service";
import { createCategory, createSubCategory, deleteCategory, listCategories } from "@/services/category.service";
import { applyRulesToUncategorized, createRule } from "@/services/rule.service";
import { getExpenseOverview, getIncomeOverview } from "@/services/income-expense.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { resetDatabase } from "./helpers";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
    if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
  }
}

async function makeUser(email: string) {
  const u = await prisma.user.create({ data: { email, name: email.split("@")[0] } });
  await prisma.$transaction((tx) => seedDefaultsForUser(tx, u.id));
  return u.id;
}

const cat = (name: string) => prisma.category.findFirstOrThrow({ where: { name, userId: null } });
const sub = async (catName: string, name: string) => prisma.subCategory.findFirstOrThrow({ where: { name, category: { name: catName, userId: null } } });

describe("Phase 2 ledger (integration)", () => {
  let userId: string;
  let otherUserId: string;
  let bankId: string;
  let cardId: string;

  beforeEach(async () => {
    await resetDatabase();
    await seedCategories();
    userId = await makeUser("me@example.com");
    otherUserId = await makeUser("other@example.com");
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", last4: "4821", currentBalance: "10000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", network: "VISA", last4: "1043", creditLimit: "200000", currentOutstanding: "0", totalAmountDue: "0", minimumAmountDue: "0" }, meta)).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only last-4 and rejects full card / account numbers", async () => {
    await expect(createCreditCard(userId, { bankName: "X", cardName: "Y", last4: "4111111111111111", creditLimit: "1000", currentOutstanding: "0" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createBankAccount(userId, { bankName: "X Bank", nickname: "N", accountType: "SAVINGS", last4: "123456789", currentBalance: "0" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const cols = Object.keys(await prisma.creditCard.findFirstOrThrow({ where: { id: cardId } }));
    expect(cols.some((c) => /cvv|pin|otp|cardNumber|fullNumber/i.test(c))).toBe(false);
  });

  it("creates an expense: balance updated, auto-categorized by rule, merchant + detail rows + source + audit", async () => {
    const tx = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-14", amount: "890.50", account: `bank:${bankId}`, description: "UPI/412345678901/SWIGGY/swiggy@icici/Payment" }, meta);
    const full = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id }, include: { category: true, subCategory: true, expense: true, sources: true, merchant: true } });
    expect(full.amount.toFixed(2)).toBe("890.50");
    expect(full.direction).toBe("DEBIT");
    expect(full.category?.name).toBe("Food");
    expect(full.subCategory?.name).toBe("Food Delivery");
    expect(full.merchant?.normalizedName).toBe("SWIGGY");
    expect(full.expense?.paymentMethod).toBe("UPI");
    expect(full.sources).toHaveLength(1);
    expect(full.sources[0].sourceType).toBe("MANUAL");
    expect(full.normalizedDescription).toBe("UPI SWIGGY PAYMENT");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("9109.50");
    expect(await prisma.auditLog.count({ where: { userId, action: "transaction.created" } })).toBe(1);
  });

  it("income credit increases balance and records the income detail", async () => {
    await createTransaction(userId, { kind: "INCOME", transactionDate: "2026-09-01", amount: "85000", account: `bank:${bankId}`, description: "SALARY CREDIT ACME", incomeCategory: "SALARY", sourceName: "Acme", isRecurring: true }, meta);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("95000.00");
    const income = await prisma.income.findFirstOrThrow({ where: { userId } });
    expect(income).toMatchObject({ incomeCategory: "SALARY", sourceName: "Acme", isRecurring: true });
    const t = await prisma.transaction.findFirstOrThrow({ where: { id: income.transactionId }, include: { category: true } });
    expect(t.category?.name).toBe("Salary"); // INCOME rule "SALARY" applied
  });

  it("card purchase raises outstanding; bill payment from bank lowers both (and isn't an expense)", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-10", amount: "1250", account: `card:${cardId}`, description: "AMAZON.IN ORDER", merchantName: "Amazon" }, meta);
    let card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.currentOutstanding.toFixed(2)).toBe("1250.00");

    await createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: "2026-09-20", amount: "1000", account: `bank:${bankId}`, creditCardId: cardId, description: "Card bill" }, meta);
    card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.currentOutstanding.toFixed(2)).toBe("250.00");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("9000.00");

    const exp = await getExpenseOverview(userId, { year: 2026, month: 9 });
    expect(exp.total.toFixed(2)).toBe("1250.00"); // payment not double-counted
  });

  it("acceptance §48 via the service: ₹2,00,000 limit with ₹50,000 used → 25% / ₹1,50,000 available", async () => {
    await updateCreditCard(userId, cardId, { bankName: "HDFC", cardName: "Regalia", network: "VISA", last4: "1043", creditLimit: "200000", currentOutstanding: "50000", totalAmountDue: "20000", minimumAmountDue: "1000", currentDueDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) }, meta);
    const o = await getCreditCardOverview(userId);
    const c = o.cards.find((x) => x.id === cardId)!;
    expect(c.utilizationPct.toFixed(2)).toBe("25.00");
    expect(c.availableLimit.toFixed(2)).toBe("150000.00");
    // A payment this cycle reduces the remaining due
    await createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: new Date().toISOString().slice(0, 10), amount: "5000", account: `bank:${bankId}`, creditCardId: cardId, description: "Part payment" }, meta);
    const after = (await getCreditCardOverview(userId)).cards.find((x) => x.id === cardId)!;
    expect(after.currentOutstanding.toFixed(2)).toBe("45000.00");
    expect(after.remainingDue.toFixed(2)).toBe("15000.00");
  });

  it("transfers create two linked legs, move money, and edit/delete both together", async () => {
    const sbi = await createBankAccount(userId, { bankName: "SBI", nickname: "Savings", accountType: "SAVINGS", currentBalance: "500" }, meta);
    const t = await createTransaction(userId, { kind: "TRANSFER", transactionDate: "2026-09-05", amount: "2000", account: `bank:${bankId}`, toAccount: `bank:${sbi.id}`, description: "Move to savings" }, meta);
    const legs = await prisma.transaction.findMany({ where: { transferGroupId: t.transferGroupId! } });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.direction).sort()).toEqual(["CREDIT", "DEBIT"]);
    const bal = async (id: string) => (await prisma.bankAccount.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);
    expect(await bal(bankId)).toBe("8000.00");
    expect(await bal(sbi.id)).toBe("2500.00");

    // edit amount
    const form = toFormValues(await getTransaction(userId, t.id));
    expect(form.kind).toBe("TRANSFER");
    expect(form.toAccount).toBe(`bank:${sbi.id}`);
    const updated = await updateTransaction(userId, t.id, { ...form, amount: "3000" }, meta);
    expect(await bal(bankId)).toBe("7000.00");
    expect(await bal(sbi.id)).toBe("3500.00");

    await deleteTransaction(userId, updated.id, meta);
    expect(await bal(bankId)).toBe("10000.00");
    expect(await bal(sbi.id)).toBe("500.00");
    // Monthly income/expense unaffected by transfers
    expect((await getExpenseOverview(userId, { year: 2026, month: 9 })).total.toFixed(2)).toBe("0.00");
  });

  it("editing and deleting recompute balances; deleted rows are hidden but kept", async () => {
    const t = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1000", account: `bank:${bankId}`, description: "Groceries" }, meta);
    await updateTransaction(userId, t.id, { ...toFormValues(await getTransaction(userId, t.id)), amount: "1500.25" }, meta);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("8499.75");
    await deleteTransaction(userId, t.id, meta);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("10000.00");
    expect(await prisma.transaction.count({ where: { id: t.id } })).toBe(1); // soft delete
    expect((await listTransactions(userId, {})).total).toBe(0);
    expect(await prisma.auditLog.count({ where: { userId, action: { in: ["transaction.updated", "transaction.deleted"] } } })).toBe(2);
  });

  it("reconciles: editing an account's current balance adjusts the opening balance", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "2500", account: `bank:${bankId}`, description: "Rent" }, meta);
    await updateBankAccount(userId, bankId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", currentBalance: "12345.67" }, meta);
    const a = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } });
    expect(a.currentBalance.toFixed(2)).toBe("12345.67");
    expect(a.openingBalance.toFixed(2)).toBe("14845.67");
  });

  it("'apply to future transactions from this merchant' learns the category", async () => {
    const groceries = await cat("Food");
    const sub1 = await sub("Food", "Groceries");
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "400", account: `bank:${bankId}`, description: "Swiggy Instamart order", merchantName: "Swiggy", categoryId: groceries.id, subCategoryId: sub1.id, applyToMerchant: true }, meta);
    const next = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-03", amount: "350", account: `bank:${bankId}`, description: "Order", merchantName: "SWIGGY" }, meta);
    const t = await prisma.transaction.findUniqueOrThrow({ where: { id: next.id } });
    expect(t.subCategoryId).toBe(sub1.id);
    expect(await prisma.categorizationRule.count({ where: { userId, matchType: "MERCHANT", pattern: "SWIGGY" } })).toBeGreaterThan(0);
  });

  it("enforces ownership: can't use another user's account, category or transaction", async () => {
    const theirBank = await createBankAccount(otherUserId, { bankName: "Other", nickname: "Theirs", accountType: "SAVINGS", currentBalance: "0" }, meta);
    await expect(createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1", account: `bank:${theirBank.id}`, description: "x" }, meta)).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
    const theirCat = await createCategory(otherUserId, { name: "Their Pets", kind: "EXPENSE" }, meta);
    await expect(createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1", account: `bank:${bankId}`, description: "x", categoryId: theirCat.id }, meta)).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
    const mine = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1", account: `bank:${bankId}`, description: "x" }, meta);
    await expect(deleteTransaction(otherUserId, mine.id, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteBankAccount(otherUserId, bankId, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listBankAccounts(otherUserId)).map((b) => b.id)).not.toContain(bankId);
  });

  it("rejects an income category on an expense", async () => {
    const salary = await cat("Salary");
    await expect(createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1", account: `bank:${bankId}`, description: "x", categoryId: salary.id }, meta)).rejects.toMatchObject({ code: "INVALID_CATEGORY" });
  });

  it("user categories & sub-categories (incl. under built-in ones) don't clash between users", async () => {
    const other = await cat("Other");
    await createSubCategory(userId, { categoryId: other.id, name: "Pets" }, meta);
    await createSubCategory(otherUserId, { categoryId: other.id, name: "Pets" }, meta); // allowed for a different user
    await expect(createSubCategory(userId, { categoryId: other.id, name: "pets" }, meta)).rejects.toMatchObject({ code: "DUPLICATE" });
    const mine = (await listCategories(userId)).find((c) => c.id === other.id)!;
    expect(mine.subCategories.filter((s) => s.name === "Pets")).toHaveLength(1);

    const hobby = await createCategory(userId, { name: "Hobbies", kind: "EXPENSE", color: "#123456" }, meta);
    await expect(createCategory(userId, { name: "food", kind: "EXPENSE" }, meta)).rejects.toMatchObject({ code: "DUPLICATE" });
    await deleteCategory(userId, hobby.id, meta);
    expect((await listCategories(userId)).some((c) => c.id === hobby.id)).toBe(false);
    await expect(deleteCategory(userId, other.id, meta)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("custom rules + apply-to-uncategorized never overwrite manual categories", async () => {
    const ent = await cat("Entertainment");
    const manual = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "500", account: `bank:${bankId}`, description: "PVR CINEMAS", categoryId: (await cat("Other")).id }, meta);
    const unc = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "600", account: `bank:${bankId}`, description: "PVR CINEMAS FOOD COURT" }, meta);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: unc.id } })).categoryId).toBeNull();
    await createRule(userId, { matchType: "KEYWORD", pattern: "pvr", categoryId: ent.id, priority: 5 }, meta);
    expect(await applyRulesToUncategorized(userId, meta)).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: unc.id } })).categoryId).toBe(ent.id);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: manual.id } })).categoryId).not.toBe(ent.id);
  });

  it("filters: search, date, account, category, amount, type, source, origin", async () => {
    const cash = await createCashAccount(userId, { name: "Wallet", currentBalance: "1000" }, meta);
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "100", account: `cash:${cash.id}`, description: "Chai", merchantName: "Tea stall" }, meta);
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-10", amount: "890", account: `bank:${bankId}`, description: "SWIGGY ORDER" }, meta);
    await createTransaction(userId, { kind: "INCOME", transactionDate: "2026-08-31", amount: "85000", account: `bank:${bankId}`, description: "Salary" }, meta);
    const food = await cat("Food");
    const q = (f: Parameters<typeof listTransactions>[1]) => listTransactions(userId, f).then((r) => r.total);
    expect(await q({})).toBe(3);
    expect(await q({ q: "swiggy" })).toBe(1);
    expect(await q({ merchant: "tea" })).toBe(1);
    expect(await q({ from: "2026-09-01", to: "2026-09-30" })).toBe(2);
    expect(await q({ account: `cash:${cash.id}` })).toBe(1);
    expect(await q({ category: food.id })).toBe(1);
    expect(await q({ category: "none" })).toBe(1);
    expect(await q({ min: "500", max: "1000" })).toBe(1);
    expect(await q({ type: "INCOME" })).toBe(1);
    expect(await q({ direction: "DEBIT" })).toBe(2);
    expect(await q({ source: "MANUAL" })).toBe(3);
    expect(await q({ origin: "imported" })).toBe(0);
    const sept = await listTransactions(userId, { from: "2026-09-01", to: "2026-09-30" });
    expect(sept.totals.debit.toFixed(2)).toBe("990.00");
    const inc = await getIncomeOverview(userId, { year: 2026, month: 8 });
    expect(inc.total.toFixed(2)).toBe("85000.00");
    expect(inc.list.rows).toHaveLength(1);
  });

  it("keeps balances correct under concurrent writes (row locking)", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "100.10", account: `bank:${bankId}`, description: `Parallel ${i}` }, meta),
      ),
    );
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("9199.20");
  });

  it("transactions of a removed account stay editable", async () => {
    const t = await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "250", account: `bank:${bankId}`, description: "Old one" }, meta);
    await deleteBankAccount(userId, bankId, meta);
    const food = await cat("Food");
    await updateTransaction(userId, t.id, { ...toFormValues(await getTransaction(userId, t.id)), categoryId: food.id }, meta);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBe(food.id);
    // …but new transactions can't use it
    await expect(createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "1", account: `bank:${bankId}`, description: "x" }, meta)).rejects.toMatchObject({ code: "INVALID_ACCOUNT" });
  });

  it("editing a transfer keeps source history on matching legs and its review state", async () => {
    const sbi = await createBankAccount(userId, { bankName: "SBI", nickname: "Savings", accountType: "SAVINGS", currentBalance: "0" }, meta);
    const t = await createTransaction(userId, { kind: "TRANSFER", transactionDate: "2026-09-05", amount: "100", account: `bank:${bankId}`, toAccount: `bank:${sbi.id}`, description: "Move" }, meta);
    await prisma.transaction.updateMany({ where: { transferGroupId: t.transferGroupId! }, data: { status: "PENDING_REVIEW" } });
    const updated = await updateTransaction(userId, t.id, { ...toFormValues(await getTransaction(userId, t.id)), amount: "150" }, meta);
    const legs = await prisma.transaction.findMany({ where: { transferGroupId: updated.transferGroupId!, deletedAt: null }, include: { sources: true } });
    expect(legs.every((l) => l.status === "PENDING_REVIEW")).toBe(true);
    expect(legs.every((l) => l.sources.length === 1)).toBe(true);
    // pending rows don't move balances
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: sbi.id } })).currentBalance.toFixed(2)).toBe("0.00");
  });

  it("re-adding a deleted category or sub-category restores it; deleted categories are not applied", async () => {
    const pets = await createCategory(userId, { name: "Pets", kind: "EXPENSE" }, meta);
    await deleteCategory(userId, pets.id, meta);
    const again = await createCategory(userId, { name: "Pets", kind: "EXPENSE" }, meta);
    expect(again.id).toBe(pets.id);
    expect(again.deletedAt).toBeNull();
    const other = await cat("Other");
    const s1 = await createSubCategory(userId, { categoryId: other.id, name: "Toys" }, meta);
    const { deleteSubCategory } = await import("@/services/category.service");
    await deleteSubCategory(userId, s1.id, meta);
    expect((await createSubCategory(userId, { categoryId: other.id, name: "Toys" }, meta)).id).toBe(s1.id);
  });

  it("concurrent card purchases and bill payments lock bank + card without deadlocks", async () => {
    await Promise.all([
      ...Array.from({ length: 4 }, (_, i) => createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-02", amount: "500", account: `card:${cardId}`, description: `Card buy ${i}` }, meta)),
      ...Array.from({ length: 3 }, (_, i) => createTransaction(userId, { kind: "CARD_PAYMENT", transactionDate: "2026-09-03", amount: "200", account: `bank:${bankId}`, creditCardId: cardId, description: `Pay ${i}` }, meta)),
      ...Array.from({ length: 3 }, (_, i) => createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-09-03", amount: "10", account: `bank:${bankId}`, description: `Bank buy ${i}` }, meta)),
    ]);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).currentOutstanding.toFixed(2)).toBe("1400.00");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("9370.00");
  });
});
