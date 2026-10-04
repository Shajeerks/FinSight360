import { describe, expect, it } from "vitest";
import { cardDueInfo, cardUtilization, nextDueDateFromDay, totalUtilization } from "@/lib/finance/credit-card";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("credit-card calculations", () => {
  it("ACCEPTANCE §48: ₹2,00,000 limit, ₹50,000 outstanding → 25% utilization, ₹1,50,000 available", () => {
    const u = cardUtilization(200000, 50000);
    expect(u.utilizationPct.toFixed(2)).toBe("25.00");
    expect(u.availableLimit.toFixed(2)).toBe("150000.00");
    expect(u.isOverLimit).toBe(false);
  });

  it("matches the spec's HDFC example (₹64,500 of ₹2,00,000 = 32.25%)", () => {
    expect(cardUtilization(200000, 64500).utilizationPct.toFixed(2)).toBe("32.25");
  });

  it("handles over-limit and zero-limit cards", () => {
    const over = cardUtilization(10000, 12500);
    expect(over.availableLimit.toNumber()).toBe(0);
    expect(over.utilizationPct.toFixed(2)).toBe("125.00");
    expect(over.isOverLimit).toBe(true);
    expect(cardUtilization(0, 0).utilizationPct.toNumber()).toBe(0);
  });

  it("aggregates utilization across cards", () => {
    const t = totalUtilization([
      { creditLimit: 200000, outstanding: 64500 },
      { creditLimit: 150000, outstanding: 18200 },
      { creditLimit: 75000, outstanding: 9850 },
    ]);
    expect(t.creditLimit.toFixed(2)).toBe("425000.00");
    expect(t.outstanding.toFixed(2)).toBe("92550.00");
    expect(t.availableLimit.toFixed(2)).toBe("332450.00");
    expect(t.utilizationPct.toFixed(2)).toBe("21.78");
  });

  it("computes days remaining and due status", () => {
    const today = d("2026-10-04");
    expect(cardDueInfo({ dueDate: d("2026-10-05"), totalAmountDue: 24500 }, today)).toMatchObject({ daysRemaining: 1, status: "DUE_SOON" });
    expect(cardDueInfo({ dueDate: d("2026-10-04"), totalAmountDue: 1 }, today).status).toBe("DUE_TODAY");
    expect(cardDueInfo({ dueDate: d("2026-10-01"), totalAmountDue: 500 }, today)).toMatchObject({ daysRemaining: -3, status: "OVERDUE" });
    expect(cardDueInfo({ dueDate: d("2026-10-30"), totalAmountDue: 500 }, today).status).toBe("UPCOMING");
    expect(cardDueInfo({ dueDate: d("2026-10-01"), totalAmountDue: 0 }, today).status).toBe("NO_DUE");
  });

  it("finds the next due date from a due day", () => {
    expect(nextDueDateFromDay(5, d("2026-10-04")).toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(nextDueDateFromDay(5, d("2026-10-06")).toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(nextDueDateFromDay(31, d("2026-11-02")).toISOString().slice(0, 10)).toBe("2026-11-30");
  });
});
