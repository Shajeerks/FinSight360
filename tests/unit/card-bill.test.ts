import { describe, expect, it } from "vitest";
import { extractCardBill } from "@/lib/import/card-bill";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("card statement bill summary", () => {
  it("header row with values on the next line (HDFC / Axis style)", () => {
    const b = extractCardBill([
      "HDFC Bank Credit Card Statement",
      "Statement Date  Payment Due Date  Total Dues  Minimum Amount Due",
      "05/10/2026      25/10/2026        12,345.67   620.00",
      "Previous Balance  Payments/Credits  Purchases/Debits  Finance Charges",
      "10,000.00         10,000.00         12,000.00         345.67",
    ]);
    expect([iso(b.statementDate), iso(b.dueDate), b.totalDue, b.minimumDue]).toEqual(["2026-10-05", "2026-10-25", "12345.67", "620.00"]);
    expect([b.previousBalance, b.paymentsCredits, b.purchases, b.financeCharges]).toEqual(["10000.00", "10000.00", "12000.00", "345.67"]);
  });

  it("label and value on the same line, month names, ₹ and Rs (ICICI / SBI style)", () => {
    const b = extractCardBill([
      "Statement Date : October 5, 2026",
      "Payment Due Date : October 25, 2026",
      "Total Amount Due ( ₹ ) 8,420.50",
      "Minimum Amount Due Rs. 430.00",
    ]);
    expect([iso(b.statementDate), iso(b.dueDate), b.totalDue, b.minimumDue]).toEqual(["2026-10-05", "2026-10-25", "8420.50", "430.00"]);
  });

  it("value on the next line, dd-Mon-yy, credit balance", () => {
    const b = extractCardBill(["Payment Due Date", "25-Nov-26", "Total Amount Due", "1,250.00 Cr"]);
    expect([iso(b.dueDate), b.totalDue]).toEqual(["2026-11-25", "-1250.00"]);
  });

  it("ignores lines without labels and nonsense figures", () => {
    const b = extractCardBill(["Credit Limit 2,00,000.00", "Card No XXXX XXXX XXXX 1234", "Minimum Amount Due 99,999.00", "Total Amount Due 500.00"]);
    expect(b.totalDue).toBe("500.00");
    expect(b.minimumDue).toBeNull(); // more than the total → not trusted
    expect(b.dueDate).toBeNull();
  });
});
