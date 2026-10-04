import { describe, expect, it } from "vitest";
import { computeMonthlySummary } from "@/lib/finance/monthly-summary";

describe("monthly summary", () => {
  it("ACCEPTANCE §50: income 85,000 / expenses 42,350 / EMI 18,500 / investment 10,000", () => {
    const s = computeMonthlySummary(
      [
        { amount: "85000", direction: "CREDIT", transactionType: "INCOME" },
        { amount: "15000", direction: "DEBIT", transactionType: "EXPENSE" },
        { amount: "27350", direction: "DEBIT", transactionType: "EXPENSE" },
        { amount: "10500", direction: "DEBIT", transactionType: "EMI" },
        { amount: "8000", direction: "DEBIT", transactionType: "EMI" },
        { amount: "5000", direction: "DEBIT", transactionType: "INVESTMENT" },
        { amount: "5000", direction: "DEBIT", transactionType: "INVESTMENT" },
        // Paying the card bill must NOT be counted as an expense again
        { amount: "20000", direction: "DEBIT", transactionType: "CARD_PAYMENT" },
        // Moving money between own accounts is ignored
        { amount: "7000", direction: "DEBIT", transactionType: "TRANSFER" },
      ],
      [{ principal: "13200", interest: "5300" }],
    );
    expect(s.income.toFixed(2)).toBe("85000.00");
    expect(s.expenses.toFixed(2)).toBe("42350.00");
    expect(s.emi.toFixed(2)).toBe("18500.00");
    expect(s.investments.toFixed(2)).toBe("10000.00");
    expect(s.interestPaid.toFixed(2)).toBe("5300.00");
    expect(s.principalPaid.toFixed(2)).toBe("13200.00");
    expect(s.creditCardPayments.toFixed(2)).toBe("20000.00");
    expect(s.netCashFlow.toFixed(2)).toBe("14150.00"); // matches the spec's October example
    expect(s.savings.toFixed(2)).toBe("24150.00");
    expect(s.savingsRatePct.toFixed(2)).toBe("28.41");
    expect(s.investmentRatePct.toFixed(2)).toBe("11.76");
  });

  it("nets refunds against expenses and counts interest credits as income", () => {
    const s = computeMonthlySummary([
      { amount: "1000", direction: "DEBIT", transactionType: "EXPENSE" },
      { amount: "250", direction: "CREDIT", transactionType: "REFUND" },
      { amount: "642", direction: "CREDIT", transactionType: "INTEREST" },
    ]);
    expect(s.expenses.toFixed(2)).toBe("750.00");
    expect(s.income.toFixed(2)).toBe("642.00");
  });

  it("returns zero rates when there is no income", () => {
    const s = computeMonthlySummary([{ amount: "100", direction: "DEBIT", transactionType: "EXPENSE" }]);
    expect(s.savingsRatePct.toNumber()).toBe(0);
    expect(s.netCashFlow.toFixed(2)).toBe("-100.00");
  });

  it("rejects negative ledger amounts", () => {
    expect(() => computeMonthlySummary([{ amount: "-5", direction: "DEBIT", transactionType: "EXPENSE" }])).toThrow();
  });
});
