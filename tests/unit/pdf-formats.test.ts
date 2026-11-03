import { describe, expect, it } from "vitest";
import { parseStatementLines } from "@/lib/import/pdf-statement";

const rows = (lines: string[], kind: "bank" | "card" = "bank") =>
  parseStatementLines(lines, { accountKind: kind }).rows.map((r) => [r.transactionDate.toISOString().slice(0, 10), r.amount, r.direction, r.description]);

describe("PDF statement layouts from different Indian banks", () => {
  it("amounts on the line after the date (wrapped narration / one cell per line)", () => {
    expect(
      rows([
        "Opening Balance 1,000.00",
        "01/10/2026   UPI/DR/628311/ZOMATO",
        "   LTD/Bangalore   250.00   750.00",
        "02/10/2026",
        "NEFT CR SALARY ACME",
        "50,000.00   50,750.00",
      ]),
    ).toEqual([
      ["2026-10-01", "250.00", "DEBIT", "UPI/DR/628311/ZOMATO LTD/Bangalore"],
      ["2026-10-02", "50000.00", "CREDIT", "NEFT CR SALARY ACME"],
    ]);
  });

  it("month-name dates in different shapes, a time after the date, Rs./INR prefixes", () => {
    expect(
      rows(["Oct 03, 2026   AMAZON   Rs. 1,200.00", "04Oct2026   SWIGGY   INR 300.00", "05-OCT-26 10:22:15   UBER   ₹ 150.50", "2026/10/06   REFUND AMAZON   200.00 Cr"], "card"),
    ).toEqual([
      ["2026-10-03", "1200.00", "DEBIT", "AMAZON"],
      ["2026-10-04", "300.00", "DEBIT", "SWIGGY"],
      ["2026-10-05", "150.50", "DEBIT", "UBER"],
      ["2026-10-06", "200.00", "CREDIT", "REFUND AMAZON"],
    ]);
  });

  it("SBI Card C/D markers, a '+' credit, and whole-rupee grouped amounts", () => {
    expect(rows(["16 Oct 26   PAYMENT RECEIVED   5,000.00 C", "17 Oct 26   FLIPKART   2,499.00 D", "18 Oct 26   CASHBACK   + 50.00", "19 Oct 26   BIGBASKET   1,250"], "card")).toEqual([
      ["2026-10-16", "5000.00", "CREDIT", "PAYMENT RECEIVED"],
      ["2026-10-17", "2499.00", "DEBIT", "FLIPKART"],
      ["2026-10-18", "50.00", "CREDIT", "CASHBACK"],
      ["2026-10-19", "1250.00", "DEBIT", "BIGBASKET"],
    ]);
  });
});
