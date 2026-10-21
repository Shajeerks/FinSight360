import { describe, expect, it } from "vitest";
import { computeMonthlySummary } from "@/lib/finance/monthly-summary";
import { cardOutstanding, accountBalance } from "@/lib/finance/balances";
import { classifyImported } from "@/lib/import/classify";
import { KIND_SPECS, categoryKindsForKind, kindOf } from "@/lib/transactions/kinds";
import { allowedKindsFor } from "@/lib/categorization/engine";

describe("Loans & borrowing are neither income nor expense", () => {
  it("monthly summary keeps borrowed money out of income and lending out of expenses", () => {
    const s = computeMonthlySummary([
      { amount: "85000", direction: "CREDIT", transactionType: "INCOME" },
      { amount: "200000", direction: "CREDIT", transactionType: "BORROWING" },
      { amount: "15000", direction: "DEBIT", transactionType: "EXPENSE" },
      { amount: "5000", direction: "DEBIT", transactionType: "BORROWING" },
    ]);
    expect(s.income.toString()).toBe("85000");
    expect(s.expenses.toString()).toBe("15000");
    expect(s.borrowed.toString()).toBe("200000");
    expect(s.lentOrRepaid.toString()).toBe("5000");
    expect(s.savings.toString()).toBe("70000");
    expect(s.savingsRatePct.toFixed(2)).toBe("82.35");
  });

  it("card-to-bank transfer raises the card outstanding; the bank side is a normal credit", () => {
    expect(cardOutstanding(1000, [
      { amount: 5000, direction: "CREDIT", transactionType: "BORROWING" },
      { amount: 2000, direction: "DEBIT", transactionType: "EXPENSE" },
      { amount: 3000, direction: "DEBIT", transactionType: "CARD_PAYMENT" },
    ]).toString()).toBe("5000");
    expect(accountBalance(100, [{ amount: 5000, direction: "CREDIT", transactionType: "BORROWING" }]).toString()).toBe("5100");
  });

  it("kinds, category kinds and reverse mapping", () => {
    expect(KIND_SPECS.BORROWED).toMatchObject({ type: "BORROWING", direction: "CREDIT" });
    expect(KIND_SPECS.LENT).toMatchObject({ type: "BORROWING", direction: "DEBIT" });
    expect(kindOf("BORROWING", "CREDIT")).toBe("BORROWED");
    expect(kindOf("BORROWING", "DEBIT")).toBe("LENT");
    expect(categoryKindsForKind("BORROWED")).toEqual(["TRANSFER"]);
    expect(allowedKindsFor("BORROWING", "CREDIT")).toEqual(["TRANSFER"]);
  });

  it("statement imports recognise loan disbursals, not ordinary credits", () => {
    expect(classifyImported("CREDIT", "bank", "LOAN DISB/PL123456/BAJAJ FINANCE")).toBe("BORROWING");
    expect(classifyImported("CREDIT", "bank", "NEFT CR-HDFC BANK-PERSONAL LOAN DISBURSEMENT")).toBe("BORROWING");
    expect(classifyImported("CREDIT", "bank", "NEFT CR ACME SALARY")).toBe("INCOME");
    expect(classifyImported("CREDIT", "bank", "UPI/RAVI/Payment")).toBe("INCOME");
    expect(classifyImported("DEBIT", "bank", "LOAN EMI HDFC")).toBe("EMI");
  });
});
