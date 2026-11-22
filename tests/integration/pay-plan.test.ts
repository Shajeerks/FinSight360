import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { createCreditCard } from "@/services/credit-card.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { buildDebtTracker, commitDebtExcel, getDebtTrackerMonth, previewDebtExcel, undoDebtExcel } from "@/services/debt-tracker.service";
import { getPayPlan } from "@/services/pay-plan.service";
import { meta, resetDatabase } from "./helpers";

const csv = readFileSync(path.join(__dirname, "..", "fixtures", "debt-fy-sheet.csv"));

describe("Financial-year sheet → Pay & Close (integration)", () => {
  let userId: string;
  let cardId: string;

  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "plan@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    cardId = (await createCreditCard(userId, { bankName: "Test", cardName: "Card", last4: "1111", creditLimit: "50000", currentOutstanding: "0" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  const importSheet = async () => {
    const p = await previewDebtExcel(userId, csv, "Debt managementFY 26-27.csv");
    expect(p.layout).toBe("fy");
    expect(p.suggestions["Test Card"]).toBe(`card:${cardId}`);
    expect(p.suggestions["Rent Home"]).toBe("commitment");
    expect(p.suggestions["Mutal Fund"]).toBe("commitment");
    const dueDays = Object.fromEntries(Object.entries(p.lenderInfo!).map(([k, v]) => [k, v.dueDay]));
    return commitDebtExcel(userId, { rows: p.rows, mapping: p.suggestions, overwrite: false, dueDays, incomes: p.incomes }, meta);
  };

  it("imports lenders, commitments, due days and income; commitments never count as debt", async () => {
    const r = await importSheet();
    expect(r).toMatchObject({ lendersCreated: 3, incomes: 3 }); // Bajaj PL (debt) + 2 commitments
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).paymentDueDay).toBe(2);
    const lenders = await prisma.debtLender.findMany({ where: { userId }, orderBy: { name: "asc" } });
    expect(lenders.map((l) => [l.name, l.kind, l.dueDay])).toEqual([["Bajaj PL", "OTHER", 4], ["Mutal Fund", "COMMITMENT", 10], ["Rent Home", "COMMITMENT", null]]);

    const may = await getDebtTrackerMonth(userId, "2026-05");
    expect(may.rows.map((x) => x.name).sort()).toEqual(["Bajaj PL", "Test Card"]);
    expect(may.totals.opening.toFixed(2)).toBe("24500.00"); // 9500 + 15000 — rent and SIP aren't debt
    expect(may.commitments.map((c) => c.name).sort()).toEqual(["Mutal Fund", "Rent Home"]);
    expect((await buildDebtTracker(userId)).closedLenders.some((c) => c.name === "Mutal Fund")).toBe(false);

    const plan = await getPayPlan(userId, "2026-05");
    const byName = Object.fromEntries(plan.items.map((i) => [i.name, i]));
    expect(byName["Test Card"]).toMatchObject({ status: "PAID" });
    expect(byName["Test Card"].dueDate?.toISOString().slice(0, 10)).toBe("2026-05-02");
    expect(byName["Rent Home"]).toMatchObject({ commitment: true });
    expect(byName["Mutal Fund"].dueDate?.toISOString().slice(0, 10)).toBe("2026-05-10");
    expect(plan.totals.due.toFixed(2)).toBe("23450.00"); // 950 + 5000 + 15000 + 2500
    expect(plan.income?.total.toFixed(2)).toBe("65000.00");
    expect(plan.income?.afterPayments.toFixed(2)).toBe("41550.00");
    expect(plan.closing.map((c) => c.name)).toEqual(["Test Card", "Bajaj PL"]); // smallest balance first
  });

  it("an open month shows what's still to pay; undo removes the imported figures and income", async () => {
    await importSheet();
    const aug = await getPayPlan(userId, "2026-08");
    const card = aug.items.find((i) => i.name === "Test Card")!;
    expect([card.amountDue.toFixed(2), card.paid.toFixed(2)]).toEqual(["920.00", "0.00"]);
    expect(aug.totals.left.greaterThan(0)).toBe(true);
    await undoDebtExcel(userId, meta);
    expect(await prisma.monthIncome.count({ where: { userId } })).toBe(0);
    expect(await prisma.debtMonthEntry.count({ where: { userId } })).toBe(0);
  });
});
