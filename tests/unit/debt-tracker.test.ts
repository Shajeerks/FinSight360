import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/money";
import { buildLenderMonths, effectiveRate, financialYearOf, fyLabel, monthsBetween, nextMonth, type AutoMonth } from "@/lib/finance/debt-tracker";
import { excelMoney, excelMonth } from "@/lib/import/debt-excel";

const d = (v: string | number) => new Decimal(v);
const flat = (payment: number, rate = 0): AutoMonth => ({ newBorrowing: d(0), payment: d(payment), interest: (o) => o.times(rate).toDecimalPlaces(2), remainingEmis: null });

describe("debt tracker: month chain", () => {
  it("opening = last month's closing; closing = opening + borrowed − paid + interest", () => {
    const rows = buildLenderMonths(["2026-08", "2026-09"], "10000", "0", () => flat(1000, 0.01));
    expect(rows.map((r) => [r.opening.toFixed(2), r.interest.toFixed(2), r.closing.toFixed(2), r.paidToDate.toFixed(2)])).toEqual([
      ["10000.00", "100.00", "9100.00", "1000.00"],
      ["9100.00", "91.00", "8191.00", "2000.00"],
    ]);
    expect(rows[1].changeFromLastMonth.toFixed(2)).toBe("-909.00");
  });

  it("an entered closing makes interest the balancing figure; an entered interest sets the closing", () => {
    const o = new Map([["2026-08", { closingOutstanding: "9300" }], ["2026-09", { interest: "50" }]]);
    const rows = buildLenderMonths(["2026-08", "2026-09"], "10000", "0", () => flat(1000), o);
    expect(rows[0].interest.toFixed(2)).toBe("300.00");
    expect(rows[1].closing.toFixed(2)).toBe("8350.00");
    expect(rows[0].entered).toEqual(["closing"]);
  });

  it("both closing and interest entered: kept as entered, the gap is shown", () => {
    const rows = buildLenderMonths(["2026-08"], "10000", "0", () => flat(1000), new Map([["2026-08", { closingOutstanding: "9300", interest: "200" }]]));
    expect(rows[0].unreconciled.toFixed(2)).toBe("100.00");
  });

  it("a statement closing from the lender wins over the estimate", () => {
    const rows = buildLenderMonths(["2026-08"], "10000", "0", () => ({ ...flat(1000, 0.5), closing: d("9200") }));
    expect(rows[0].interest.toFixed(2)).toBe("200.00");
  });

  it("paid till date continues from an entered figure", () => {
    const rows = buildLenderMonths(["2026-08", "2026-09"], "0", "500", () => flat(100), new Map([["2026-08", { paidToDate: "5000" }]]));
    expect(rows.map((r) => r.paidToDate.toFixed(2))).toEqual(["5000.00", "5100.00"]);
  });
});

describe("debt tracker: helpers", () => {
  it("months, financial year, effective rate", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(nextMonth("2026-01", -1)).toBe("2025-12");
    expect(financialYearOf("2027-03")).toBe(2026);
    expect(financialYearOf("2026-04")).toBe(2026);
    expect(fyLabel(2026)).toBe("FY 2026-27");
    expect(effectiveRate("1500", "100000")).toEqual({ monthlyPct: d("1.5"), annualPct: d("18") });
    expect(effectiveRate("10", "0")).toBeNull();
  });

  it("Excel cells: amounts and months in common formats", () => {
    expect(excelMoney(1234.567)).toBe("1234.57");
    expect(excelMoney("₹1,23,456.50")).toBe("123456.50");
    expect(excelMoney("(2,000)")).toBe("-2000.00");
    expect(excelMoney("-")).toBeNull();
    expect(excelMonth("Oct 2026")).toBe("2026-10");
    expect(excelMonth("October-26")).toBe("2026-10");
    expect(excelMonth("Sept'25")).toBe("2025-09");
    expect(excelMonth("10/2026")).toBe("2026-10");
    expect(excelMonth(new Date(Date.UTC(2026, 9, 1)))).toBe("2026-10");
    expect(excelMonth("Sheet1")).toBeNull();
  });
});
