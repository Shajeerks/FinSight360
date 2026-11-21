import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/money";
import { buildLenderMonths, effectiveRate, financialYearOf, fyLabel, isIdleSettledRow, monthsBetween, nextMonth, settlementOf, type AutoMonth } from "@/lib/finance/debt-tracker";
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

describe("debt tracker: closed loans and zero-balance cards", () => {
  const months = ["2026-07", "2026-08", "2026-09", "2026-10"];
  const pay = (byMonth: Record<string, number>) => (m: string) => flat(byMonth[m] ?? 0);

  it("a loan paid down to zero is settled in the month the balance reached zero", () => {
    const rows = buildLenderMonths(months, "2000", "0", pay({ "2026-07": 1000, "2026-08": 1000 }));
    const s = settlementOf(rows, { explicitlyClosed: false });
    expect(s.settled).toBe(true);
    expect(s.closedMonth).toBe("2026-08");
    expect(s.firstMonth).toBe("2026-07");
    expect(s.lastPaymentMonth).toBe("2026-08");
    expect(s.totalPaid.toFixed(2)).toBe("2000.00");
    expect(isIdleSettledRow(rows[3])).toBe(true);
    expect(isIdleSettledRow(rows[1])).toBe(false);
  });

  it("a balance still owed is not settled; a ₹1 rounding residue is", () => {
    expect(settlementOf(buildLenderMonths(months, "2000", "0", pay({ "2026-07": 1000 })), { explicitlyClosed: false }).settled).toBe(false);
    expect(settlementOf(buildLenderMonths(months, "2000", "0", pay({ "2026-07": 1999.5 })), { explicitlyClosed: false }).settled).toBe(true);
  });

  it("a loan marked closed/foreclosed is settled even if the tracker still shows a balance", () => {
    const s = settlementOf(buildLenderMonths(months, "2000", "0", pay({})), { explicitlyClosed: true });
    expect(s.settled).toBe(true);
    expect(s.closedMonth).toBeNull();
  });

  it("an unused card with no balance is settled only when zero counts as settled", () => {
    const rows = buildLenderMonths(months, "0", "0", pay({}));
    expect(settlementOf(rows, { explicitlyClosed: false }).settled).toBe(false);
    const card = settlementOf(rows, { explicitlyClosed: false, zeroCountsAsSettled: true });
    expect(card.settled).toBe(true);
    expect(card.hadDebt).toBe(false);
  });

  it("spending again after paying off reopens it", () => {
    const rows = buildLenderMonths(months, "1000", "0", (m) => (m === "2026-10" ? { ...flat(0), newBorrowing: d(500) } : pay({ "2026-07": 1000 })(m)));
    expect(settlementOf(rows, { explicitlyClosed: false, zeroCountsAsSettled: true }).settled).toBe(false);
  });
});
