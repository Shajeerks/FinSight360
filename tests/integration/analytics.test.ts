import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { detectRecurringForUser, listRecurring, updateRecurring } from "@/services/recurring.service";
import { budgetProgress, deleteBudget, saveBudget } from "@/services/budget.service";
import { getAnalytics } from "@/services/analytics.service";
import { buildReport, reportToCsv, reportToXlsx } from "@/services/report.service";
import { netWorthHistory, recordNetWorthSnapshot } from "@/services/networth.service";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import ExcelJS from "exceljs";
import { meta, resetDatabase } from "./helpers";

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

describe("Phase 7 analytics (integration)", () => {
  let userId: string;
  let bank: string;
  let food: string;
  beforeEach(async () => {
    await resetDatabase();
    for (const c of DEFAULT_CATEGORIES) {
      const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
      if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
    }
    userId = (await prisma.user.create({ data: { email: "an@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bank = `bank:${(await createBankAccount(userId, { bankName: "HDFC", nickname: "Salary", accountType: "SALARY", currentBalance: "100000" }, meta)).id}`;
    food = (await prisma.category.findFirstOrThrow({ where: { name: "Food", userId: null } })).id;
    for (let m = 5; m <= 9; m++) {
      await createTransaction(userId, { kind: "INCOME", transactionDate: ymd(2026, m, 1), amount: "85000", account: bank, description: "NEFT ACME SALARY", merchantName: "ACME TECH", incomeCategory: "SALARY" }, meta);
      await createTransaction(userId, { kind: "EXPENSE", transactionDate: ymd(2026, m, 12), amount: "649", account: bank, description: "NETFLIX", merchantName: "NETFLIX" }, meta);
      await createTransaction(userId, { kind: "EXPENSE", transactionDate: ymd(2026, m, 15), amount: String(3000 + m * 100), account: bank, description: "SWIGGY order", merchantName: "SWIGGY", categoryId: food }, meta);
      await createTransaction(userId, { kind: "EMI", transactionDate: ymd(2026, m, 5), amount: "20000", account: bank, description: "HDFC car loan EMI" }, meta);
    }
  });
  afterAll(() => prisma.$disconnect());

  it("detects recurring income and subscriptions; confirm / dismiss persist across re-detection", async () => {
    const r = await detectRecurringForUser(userId);
    expect(r.created).toBeGreaterThanOrEqual(3);
    let list = await listRecurring(userId);
    const netflix = list.rows.find((x) => x.name.toUpperCase().includes("NETFLIX"))!;
    expect(netflix).toMatchObject({ frequency: "MONTHLY", status: "DETECTED", dayOfMonth: 12 });
    expect(netflix.expectedAmount.toFixed(2)).toBe("649.00");
    const salary = list.rows.find((x) => x.direction === "CREDIT")!;
    await updateRecurring(userId, netflix.id, { status: "CONFIRMED" }, meta);
    await updateRecurring(userId, salary.id, { status: "DISMISSED" }, meta);
    await detectRecurringForUser(userId);
    list = await listRecurring(userId);
    expect(list.rows.find((x) => x.id === salary.id)).toBeUndefined();
    expect(list.rows.find((x) => x.id === netflix.id)?.status).toBe("CONFIRMED");
    expect(list.monthlyOut.toFixed(2)).toBe("649.00");
    const other = (await prisma.user.create({ data: { email: "x@example.com" } })).id;
    await expect(updateRecurring(other, netflix.id, { status: "PAUSED" }, meta)).rejects.toMatchObject({ status: 404 });
  });

  it("budgets count net spending (refunds reduce it) and warn at the threshold", async () => {
    await saveBudget(userId, null, { categoryId: food, amount: "4000", alertThresholdPct: 80 }, meta);
    await saveBudget(userId, null, { amount: "5000" }, meta);
    await expect(saveBudget(userId, null, { categoryId: food, amount: "1" }, meta)).rejects.toMatchObject({ code: "BUDGET_EXISTS" });
    await createTransaction(userId, { kind: "REFUND", transactionDate: ymd(2026, 9, 20), amount: "300", account: bank, description: "Swiggy refund", categoryId: food }, meta);
    const p = await budgetProgress(userId, { year: 2026, month: 9 });
    const f = p.find((b) => b.categoryId === food)!;
    expect(f.spent.toFixed(2)).toBe("3600.00"); // 3900 − 300
    expect(f.status).toBe("WARNING");
    const total = p.find((b) => b.categoryId === null)!;
    expect(total.spent.toFixed(2)).toBe("4249.00"); // 649 + 3900 − 300 (EMI isn't spending)
    await deleteBudget(userId, f.id, meta);
    expect(await budgetProgress(userId, { year: 2026, month: 9 })).toHaveLength(1);
  });

  it("monthly analysis: comparisons, category trends, ratios, unusual payments", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: ymd(2026, 9, 22), amount: "48000", account: bank, description: "CROMA TV", merchantName: "CROMA", categoryId: food }, meta);
    const a = await getAnalytics(userId, { year: 2026, month: 9 });
    expect(a.summary.income.toFixed(2)).toBe("85000.00");
    expect(a.summary.emi.toFixed(2)).toBe("20000.00");
    expect(a.series).toHaveLength(12);
    expect(a.ratios.emiRate).toBeCloseTo(23.5, 1);
    expect(a.comparison.expenses).toBeGreaterThan(0);
    expect(a.categories[0].id).toBe(food);
    expect(a.unusual[0].id).toBeDefined();
    expect(String(a.unusual[0].amount)).toBe("48000");
  });

  it("reports export to CSV (formula-safe) and Excel; net-worth snapshots", async () => {
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: ymd(2026, 9, 3), amount: "10", account: bank, description: "=HYPERLINK(\"http://evil\")" }, meta);
    const r = await buildReport(userId, { type: "transactions", from: "2026-09-01", to: "2026-09-30" });
    expect(r.rows.length).toBe(5);
    const csv = reportToCsv(r);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.startsWith("﻿Date,Description")).toBe(true);
    const exp = await buildReport(userId, { type: "expenses", from: "2026-09-01", to: "2026-09-30" });
    expect(exp.totals?.net).toBe("4559.00"); // 649 + 3900 + 10
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await reportToXlsx(exp)) as unknown as ArrayBuffer);
    expect(wb.worksheets[0].getRow(3).getCell(1).value).toBe("Category");
    await expect(buildReport(userId, { type: "expenses", from: "2026-09-30", to: "2026-09-01" })).rejects.toMatchObject({ status: 422 });
    const loans = await buildReport(userId, { type: "interest", from: "2026-01-01", to: "2026-12-31" });
    expect(loans.rows.at(-1)?.kind).toBe("Earned");

    const card = await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "100000", currentOutstanding: "20000" }, meta);
    expect(card.id).toBeTruthy();
    const snap = await recordNetWorthSnapshot(userId);
    await recordNetWorthSnapshot(userId); // same day → upsert
    expect((await netWorthHistory(userId)).length).toBe(1);
    expect(snap.totalLiabilities.toFixed(2)).toBe("20000.00");
  });
});
