import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { dueDayOf, fyMonth, fyStartFromName, isFySheet, parseFySheet } from "@/lib/import/debt-fy-sheet";
import { monthsToClose, snowball } from "@/lib/finance/closing-plan";

const grid = Papa.parse<string[]>(readFileSync(path.join(__dirname, "..", "fixtures", "debt-fy-sheet.csv"), "utf8")).data;

describe("financial-year debt sheet", () => {
  it("helpers: FY from the name, month labels (with typos) and due days", () => {
    expect(fyStartFromName("Debt managementFY 26-27.csv")).toBe(2026);
    expect(fyStartFromName("FY 2025-26")).toBe(2025);
    expect(fyMonth("Auguest ", 2026)).toBe("2026-08");
    expect(fyMonth("January", 2026)).toBe("2027-01");
    expect(dueDayOf("2nd of every Month")).toBe(2);
    expect(dueDayOf("05th of every Month")).toBe(5);
  });

  it("reads one row per lender per month: outstanding, amount due, paid, remaining", () => {
    expect(isFySheet(grid)).toBe(true);
    const s = parseFySheet(grid, 2026);
    expect(s.months).toEqual(["2026-04", "2026-05", "2026-08"]);
    const card = s.rows.filter((r) => r.lender === "Test Card");
    expect(card.map((r) => [r.month, r.openingOutstanding, r.amountDue, r.payment, r.closingOutstanding, r.remainingEmis])).toEqual([
      ["2026-04", "10000.00", "1000.00", "1000.00", "9000.00", null],
      ["2026-05", "9500.00", "950.00", "950.00", "8550.00", null], // a card's "remaining EMI" cell is ignored
      ["2026-08", "9200.00", "920.00", null, null, null], // still open: the app fills the payment from statements
    ]);
    expect(s.rows.find((r) => r.lender === "Bajaj PL" && r.month === "2026-05")?.remainingEmis).toBe(2);
    expect(s.rows.every((r) => r.interest === null)).toBe(true); // the sheet's interest column isn't trusted
  });

  it("types, due days, commitments and income", () => {
    const s = parseFySheet(grid, 2026);
    const kind = Object.fromEntries(s.lenders.map((l) => [l.name, [l.suggestedKind, l.dueDay]]));
    expect(kind).toEqual({ "Test Card": ["DEBT", 2], "Bajaj PL": ["DEBT", 4], "Rent Home": ["COMMITMENT", null], "Mutal Fund": ["COMMITMENT", 10] });
    expect(s.incomes).toEqual([
      { month: "2026-04", salary: "63000.00", otherIncome: "5000.00" },
      { month: "2026-05", salary: "63000.00", otherIncome: "2000.00" },
      { month: "2026-08", salary: "64000.00", otherIncome: null },
    ]);
  });
});

describe("closing plan", () => {
  it("months to close at today's pace, and sooner with an extra amount (smallest first, rolling over)", () => {
    const debts = [
      { key: "a", name: "A", balance: 3000, monthly: 1000 },
      { key: "b", name: "B", balance: 10000, monthly: 1000 },
      { key: "c", name: "C", balance: 5000, monthly: 500, emisLeft: 10 },
    ];
    expect(debts.map(monthsToClose)).toEqual([3, 10, 10]);
    const plan = Object.fromEntries(snowball(debts, 1000).map((r) => [r.key, r.months]));
    expect(plan.a).toBe(2);
    expect(plan.c! < 10 && plan.b! < 10).toBe(true);
    // Even with no extra, a closed debt's payment rolls on to the next one.
    const rolled = Object.fromEntries(snowball(debts, 0).map((r) => [r.key, r.months]));
    expect(rolled.a).toBe(3);
    expect(rolled.b!).toBeLessThan(10);
  });
});
