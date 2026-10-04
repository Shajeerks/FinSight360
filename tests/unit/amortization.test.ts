import { describe, expect, it } from "vitest";
import { calculateEmi, generateAmortizationSchedule, scheduleTotalsBetween, summarizeSchedule } from "@/lib/finance/amortization";
import { sum } from "@/lib/money";

const first = new Date("2026-11-05T00:00:00.000Z");

describe("loan amortization", () => {
  it("computes the standard EMI", () => {
    // ₹10,00,000 @ 9.5% for 60 months → ₹21,001.86 (reducing balance)
    expect(calculateEmi(1000000, 9.5, 60).toFixed(2)).toBe("21001.86");
    expect(calculateEmi(1000000, 9.5, 60, "MONTHLY", true).toFixed(0)).toBe("21002");
    expect(calculateEmi(120000, 0, 12).toFixed(2)).toBe("10000.00");
  });

  it("ACCEPTANCE §49: ₹10,00,000 @ 9.5% for 60 months produces a valid schedule", () => {
    const rows = generateAmortizationSchedule({ principal: 1000000, annualRatePct: 9.5, tenureMonths: 60, firstDueDate: first });
    expect(rows).toHaveLength(60);

    rows.forEach((r, i) => {
      // Every EMI has principal, interest, opening and closing balance
      expect(r.installmentNumber).toBe(i + 1);
      expect(r.principal.greaterThan(0)).toBe(true);
      expect(r.interest.greaterThanOrEqualTo(0)).toBe(true);
      // opening − principal = closing
      expect(r.openingPrincipal.minus(r.principal).equals(r.closingPrincipal)).toBe(true);
      // principal + interest = EMI
      expect(r.principal.plus(r.interest).equals(r.emi)).toBe(true);
      // closing of one row = opening of the next
      if (i > 0) expect(rows[i - 1].closingPrincipal.equals(r.openingPrincipal)).toBe(true);
    });

    // First instalment: interest = 10,00,000 × 9.5%/12 = 7,916.67
    expect(rows[0].interest.toFixed(2)).toBe("7916.67");
    expect(rows[0].principal.toFixed(2)).toBe("13085.19");
    // Loan is fully repaid, principal components sum to the principal exactly
    expect(rows[59].closingPrincipal.toFixed(2)).toBe("0.00");
    expect(sum(rows.map((r) => r.principal)).toFixed(2)).toBe("1000000.00");
    // Interest declines over time
    expect(rows[59].interest.lessThan(rows[0].interest)).toBe(true);
  });

  it("schedules due dates monthly, clamping short months", () => {
    const rows = generateAmortizationSchedule({ principal: 100000, annualRatePct: 10, tenureMonths: 4, firstDueDate: new Date("2026-01-31T00:00:00Z") });
    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("summarizes interest totals and interest-to-principal ratio", () => {
    const rows = generateAmortizationSchedule({ principal: 1000000, annualRatePct: 9.5, tenureMonths: 60, firstDueDate: first });
    const s = summarizeSchedule(rows);
    expect(s.totalPrincipal.toFixed(2)).toBe("1000000.00");
    expect(s.totalPayment.minus(s.totalInterest).toFixed(2)).toBe("1000000.00");
    // ≈ ₹2,60,111 total interest
    expect(s.totalInterest.toNumber()).toBeGreaterThan(260000);
    expect(s.totalInterest.toNumber()).toBeLessThan(260200);
    const year1 = scheduleTotalsBetween(rows, new Date("2026-11-01T00:00:00Z"), new Date("2027-11-01T00:00:00Z"));
    expect(year1.count).toBe(12);
  });

  it("supports a lender-quoted (rounded) EMI and still closes at zero", () => {
    const rows = generateAmortizationSchedule({ principal: 500000, annualRatePct: 9.5, tenureMonths: 60, firstDueDate: first, emi: 10500 });
    expect(rows[0].emi.toFixed(2)).toBe("10500.00");
    expect(rows[rows.length - 1].closingPrincipal.toNumber()).toBe(0);
    expect(sum(rows.map((r) => r.principal)).toFixed(2)).toBe("500000.00");
  });

  it("supports quarterly payments", () => {
    const rows = generateAmortizationSchedule({ principal: 120000, annualRatePct: 12, tenureMonths: 12, frequency: "QUARTERLY", firstDueDate: first });
    expect(rows).toHaveLength(4);
    expect(rows[0].interest.toFixed(2)).toBe("3600.00"); // 3% per quarter
    expect(rows[1].dueDate.toISOString().slice(0, 10)).toBe("2027-02-05");
  });

  it("rejects invalid input", () => {
    expect(() => calculateEmi(0, 9, 12)).toThrow();
    expect(() => calculateEmi(1000, -1, 12)).toThrow();
    expect(() => calculateEmi(1000, 9, 0)).toThrow();
    expect(() => generateAmortizationSchedule({ principal: 100000, annualRatePct: 24, tenureMonths: 12, firstDueDate: first, emi: 1000 })).toThrow(/too small/);
  });
});

import { emiForInstallments, nextInstallmentDate, projectRemainingSchedule } from "@/lib/finance/amortization";

describe("remaining-schedule projection", () => {
  it("matches the original schedule when nothing changed", () => {
    const full = generateAmortizationSchedule({ principal: 1000000, annualRatePct: 9.5, tenureMonths: 60, firstDueDate: first });
    const rest = projectRemainingSchedule({ outstanding: full[11].closingPrincipal, annualRatePct: 9.5, emi: full[0].emi, nextDueDate: full[12].dueDate, startInstallment: 13 });
    expect(rest).toHaveLength(48);
    expect(rest[0].interest.toFixed(2)).toBe(full[12].interest.toFixed(2));
    expect(rest[rest.length - 1].closingPrincipal.toNumber()).toBe(0);
  });

  it("a prepayment keeping the EMI shortens the tenure and saves interest", () => {
    const full = generateAmortizationSchedule({ principal: 1000000, annualRatePct: 9.5, tenureMonths: 60, firstDueDate: first });
    const after = full[11].closingPrincipal.minus(200000);
    const rest = projectRemainingSchedule({ outstanding: after, annualRatePct: 9.5, emi: full[0].emi, nextDueDate: full[12].dueDate, startInstallment: 13 });
    expect(rest.length).toBeLessThan(48);
    const before = summarizeSchedule(full.slice(12)).totalInterest;
    expect(summarizeSchedule(rest).totalInterest.lessThan(before)).toBe(true);
    expect(sum(rest.map((r) => r.principal)).toFixed(2)).toBe(after.toFixed(2));
  });

  it("a prepayment keeping the tenure lowers the EMI", () => {
    const newEmi = emiForInstallments(500000, 9.5, 48);
    expect(newEmi.lessThan(calculateEmi(1000000, 9.5, 60))).toBe(true);
    const rest = projectRemainingSchedule({ outstanding: 500000, annualRatePct: 9.5, emi: newEmi, nextDueDate: first, startInstallment: 13 });
    expect(rest).toHaveLength(48);
  });

  it("guards against EMIs that don't cover interest", () => {
    expect(() => projectRemainingSchedule({ outstanding: 100000, annualRatePct: 24, emi: 1000, nextDueDate: first, startInstallment: 1 })).toThrow(/too small/);
    expect(nextInstallmentDate(new Date("2026-01-31T00:00:00Z"), "MONTHLY", 31).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
