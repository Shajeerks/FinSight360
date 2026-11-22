import { describe, expect, it } from "vitest";
import { bestLoanMatch, lenderTokens, scoreLoanPayment, type LoanForMatch } from "@/lib/finance/loan-match";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const indusind: LoanForMatch = { id: "indusind", lender: "Indusind Bank", name: "Personal Loan", accountLast4: null, emiAmount: "6884", dueDates: [d("2026-08-04"), d("2026-09-04")] };
const amazon: LoanForMatch = { id: "amazon", lender: "Amazon Pay", name: "Personal loan", accountLast4: null, emiAmount: "5671", dueDates: [d("2026-08-05")] };
const kredit: LoanForMatch = { id: "kredit", lender: "kredit bee", name: "kredit bee", accountLast4: "4455", emiAmount: "9594", dueDates: [d("2026-08-10")] };
const debit = (description: string, amount: string, date = "2026-08-04", transactionType = "EXPENSE") => ({ description, amount, merchantName: null, transactionType, transactionDate: d(date) });

describe("matching bank debits to loans", () => {
  it("finds the lender's name squashed into a NACH code", () => {
    expect(lenderTokens("Indusind Bank")).toContain("INDUSIND");
    expect(lenderTokens("kredit bee")).toContain("KREDITBEE");
    const m = bestLoanMatch(debit("NACH00000000022163 BD- IndusindBan", "6884.00"), [indusind, amazon, kredit])!;
    expect(m.loanId).toBe("indusind");
    expect(m.confident).toBe(true);
  });

  it("an e-mandate debit of the EMI amount is suggested but not linked automatically without the lender's name", () => {
    const m = bestLoanMatch(debit("ICIC00261000001992 TP EMANDATE CA", "5671.00", "2026-08-05"), [indusind, amazon, kredit])!;
    expect(m.loanId).toBe("amazon");
    expect(m.confident).toBe(false);
  });

  it("the loan number counts as strongly as the name", () => {
    expect(bestLoanMatch(debit("IMPS/623/LOAN A/C 4455 REPAYMENT", "9594.00", "2026-08-10"), [indusind, kredit])?.confident).toBe(true);
  });

  it("ordinary spends don't match, even of a similar size", () => {
    expect(bestLoanMatch(debit("UPI/DR/612477186110/Amazon P/RATN/amazonpayl", "3435.37"), [indusind, amazon])).toBeNull();
    expect(scoreLoanPayment(debit("UPI/DR/SWIGGY", "6884.00", "2026-06-20"), indusind).score).toBeLessThan(85);
  });

  it("two loans with the same EMI and no name: not linked automatically", () => {
    const twin = { ...indusind, id: "twin", lender: "Other Finance", name: "Loan" };
    expect(bestLoanMatch(debit("NACH DEBIT", "6884.00"), [indusind, twin])?.confident).toBe(false);
  });
});
