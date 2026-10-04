import { describe, expect, it } from "vitest";
import { addFrequency, detectRecurring, monthlyEquivalent, type RecurringInput } from "@/lib/analytics/recurring";
import { categoryTrends, findUnusual, ratios, ratioTips } from "@/lib/analytics/insights";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const item = (key: string, date: string, amount: string, direction: "DEBIT" | "CREDIT" = "DEBIT"): RecurringInput => ({ key, name: key.toUpperCase(), transactionDate: d(date), amount, direction });

describe("recurring detection", () => {
  it("finds monthly subscriptions and salary, ignores irregular spending", () => {
    const items = [
      ...["2026-04-05", "2026-05-05", "2026-06-06", "2026-07-05", "2026-08-05", "2026-09-05"].map((x) => item("netflix", x, "649")),
      ...["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].map((x) => item("acme", x, "85000", "CREDIT")),
      ...["2026-09-02", "2026-09-03", "2026-09-20", "2026-08-11"].map((x, i) => item("swiggy", x, String(300 + i * 97))),
      item("gym", "2026-01-10", "12000"), item("gym", "2026-07-10", "12000"),
    ];
    const s = detectRecurring(items);
    const netflix = s.find((x) => x.key === "netflix")!;
    expect(netflix).toMatchObject({ frequency: "MONTHLY", occurrences: 6, dayOfMonth: 5 });
    expect(netflix.expectedAmount.toFixed(2)).toBe("649.00");
    expect(netflix.nextDue.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(s.find((x) => x.key === "acme")?.direction).toBe("CREDIT");
    expect(s.find((x) => x.key === "swiggy")).toBeUndefined();
    expect(s.find((x) => x.key === "gym")?.frequency).toBe("HALF_YEARLY");
  });

  it("tolerates one odd amount but not wildly varying ones", () => {
    const steady = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((x, i) => item("power", x, i === 2 ? "2600" : "2000"));
    expect(detectRecurring(steady)[0].expectedAmount.toFixed(2)).toBe("2000.00");
    const wild = ["2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10"].map((x, i) => item("shop", x, String(500 * (i + 1) ** 2)));
    expect(detectRecurring(wild)).toHaveLength(0);
  });

  it("date helpers", () => {
    expect(addFrequency(d("2026-01-31"), "MONTHLY", 31).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(monthlyEquivalent("1200", "YEARLY").toFixed(2)).toBe("100.00");
    expect(monthlyEquivalent("100", "WEEKLY").toFixed(2)).toBe("433.33");
  });
});

describe("spending intelligence", () => {
  it("category trends vs last month and the 3-month average", () => {
    const t = categoryTrends(
      [{ id: "food", name: "Food", amount: "6000" }, { id: "fuel", name: "Fuel", amount: "4000" }],
      [{ id: "food", name: "Food", amount: "4000" }],
      [[{ id: "food", name: "Food", amount: "4000" }], [{ id: "food", name: "Food", amount: "5000" }], [{ id: "food", name: "Food", amount: "6000" }]],
    );
    expect(t[0]).toMatchObject({ id: "food", changePct: 50, vsAveragePct: 20, share: 60 });
    expect(t[1]).toMatchObject({ id: "fuel", changePct: null });
  });

  it("flags large, spiky and first-time payments", () => {
    const hist = Array.from({ length: 12 }, (_, i) => ({ id: `h${i}`, transactionDate: d("2026-06-01"), amount: String(800 + i * 10), description: "x", merchantKey: "AMAZON", categoryId: "shop" }));
    const u = findUnusual(
      [
        { id: "a", transactionDate: d("2026-09-02"), amount: "45000", description: "TV", merchantKey: "AMAZON", categoryId: "shop" },
        { id: "b", transactionDate: d("2026-09-03"), amount: "850", description: "x", merchantKey: "AMAZON", categoryId: "shop" },
        { id: "c", transactionDate: d("2026-09-04"), amount: "3500", description: "y", merchantKey: "NEWSHOP", categoryId: "shop" },
      ],
      hist,
    );
    expect(u.map((x) => x.id)).toEqual(["a", "c"]);
    expect(u[0].reasons[0]).toMatch(/× your usual/);
    expect(u[1].reasons).toContain("First payment to this merchant");
  });

  it("ratios and tips", () => {
    const r = ratios({ income: "100000", expenses: "40000", emi: "45000", investments: "10000", savings: "15000" });
    expect(r).toEqual({ savingsRate: 15, investmentRate: 10, emiRate: 45, expenseRate: 40 });
    expect(ratioTips(r)[0].tone).toBe("warning");
    expect(ratios({ income: "0", expenses: "1", emi: "0", investments: "0", savings: "-1" }).savingsRate).toBeNull();
  });
});
