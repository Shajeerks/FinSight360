import { describe, expect, it } from "vitest";
import { cashFlowsOf, computePosition, instrumentKeyOf, parseAmfiNav, PositionError, valueHolding, xirr, type InvTxn } from "@/lib/investments/calc";
import { parseGrowwRows } from "@/lib/investments/groww";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const t = (type: InvTxn["type"], date: string, quantity: string, price: string, amount?: string, charges = "0"): InvTxn => ({ type, tradeDate: d(date), quantity, price, amount: amount ?? (Number(quantity) * Number(price)).toFixed(2), charges });

describe("positions (weighted average cost)", () => {
  it("buys, partial sell and realised gain", () => {
    const p = computePosition([t("BUY", "2026-01-10", "10", "100"), t("BUY", "2026-02-10", "10", "120"), t("SELL", "2026-03-10", "5", "150")]);
    expect(p.quantity.toString()).toBe("15");
    expect(p.averageBuyPrice.toString()).toBe("110");
    expect(p.investedAmount.toFixed(2)).toBe("1650.00");
    expect(p.realizedGainLoss.toFixed(2)).toBe("200.00"); // 750 − 5 × 110
  });

  it("charges add to cost / reduce proceeds; bonus lowers average; dividends tracked separately", () => {
    const p = computePosition([t("BUY", "2026-01-01", "10", "100", "1000.00", "20"), t("BONUS", "2026-02-01", "10", "0", "0"), t("DIVIDEND", "2026-03-01", "0", "0", "55.50"), t("SELL", "2026-04-01", "4", "80", "320.00", "5")]);
    expect(p.averageBuyPrice.toString()).toBe("51");
    expect(p.quantity.toString()).toBe("16");
    expect(p.realizedGainLoss.toFixed(2)).toBe("111.00"); // 320 − 5 − 4×51
    expect(p.dividends.toFixed(2)).toBe("55.50");
  });

  it("mutual fund units to 6 decimals; full redemption resets cost", () => {
    const p = computePosition([t("SIP", "2026-01-05", "45.123456", "110.8", "5000.00"), t("SIP", "2026-02-05", "44.802867", "111.6", "5000.00"), t("REDEMPTION", "2026-03-05", "89.926323", "120", "10791.16")]);
    expect(p.quantity.toString()).toBe("0");
    expect(p.investedAmount.toFixed(2)).toBe("0.00");
    expect(p.realizedGainLoss.toFixed(2)).toBe("791.16");
  });

  it("refuses to sell units that aren't held", () => {
    expect(() => computePosition([t("BUY", "2026-01-01", "5", "100"), t("SELL", "2026-01-02", "6", "100")])).toThrow(PositionError);
  });

  it("values holdings and computes XIRR", () => {
    expect(valueHolding({ quantity: "15", investedAmount: "1650", currentPrice: "130" })).toMatchObject({ current: expect.anything() });
    const v = valueHolding({ quantity: "15", investedAmount: "1650", currentPrice: "130" });
    expect([v.current.toFixed(2), v.gain.toFixed(2), v.gainPct?.toString()]).toEqual(["1950.00", "300.00", "18.18"]);
    // −10,000 today, +11,000 in exactly one year → 10%.
    expect(xirr([{ date: d("2025-01-01"), amount: -10000 }, { date: d("2026-01-01"), amount: 11000 }])).toBeCloseTo(10, 1);
    // Monthly SIP of 5,000 for 12 months valued at 64,000 → ≈ 14.9%
    const flows = Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2025, i, 5)), amount: -5000 }));
    const r = xirr([...flows, { date: d("2026-01-05"), amount: 64000 }]);
    expect(r).toBeGreaterThan(12);
    expect(r).toBeLessThan(18);
    expect(xirr([{ date: d("2026-01-01"), amount: -100 }])).toBeNull();
    expect(cashFlowsOf([t("BUY", "2026-01-01", "1", "100", "100.00", "2")])[0].amount).toBe(-102);
  });

  it("instrument keys and AMFI NAV file", () => {
    expect(instrumentKeyOf({ isin: "ine002a01018", instrumentName: "Reliance" })).toBe("ISIN:INE002A01018");
    expect(instrumentKeyOf({ symbol: "tcs", instrumentName: "TCS" })).toBe("SYM:TCS");
    expect(instrumentKeyOf({ instrumentName: "Parag Parikh Flexi Cap - Direct (G)" })).toBe("NAME:PARAG PARIKH FLEXI CAP DIRECT G");
    const nav = parseAmfiNav([
      "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date",
      "",
      "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
      "122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;89.1234;03-Oct-2026",
      "999999;INF000X01011;INF000X01029;Some IDCW plan;N.A.;03-Oct-2026",
    ].join("\n"));
    expect(nav.get("INF879O01027")).toMatchObject({ nav: "89.1234" });
    expect(nav.get("INF879O01027")?.date.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(nav.size).toBe(1);
  });
});

describe("Groww file parser", () => {
  it("stock holdings report (header below a title block)", () => {
    const r = parseGrowwRows([
      ["Holdings statement for stocks as on 03-10-2026"],
      ["Name", "Shajeer"],
      [],
      ["Stock Name", "ISIN", "Quantity", "Average buy price", "Buy value", "Closing price", "Closing value", "Unrealised P&L"],
      ["RELIANCE INDUSTRIES LTD", "INE002A01018", "10", "2,450.50", "24,505.00", "2,910.00", "29,100.00", "4,595.00"],
      ["NIPPON INDIA ETF NIFTY BEES", "INF204KB14I2", "50", "240.10", "12,005.00", "265.00", "13,250.00", "1,245.00"],
      ["Total", "", "", "", "36,510.00", "", "42,350.00", ""],
    ]);
    expect(r.kind).toBe("HOLDINGS");
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings[0]).toMatchObject({ instrumentType: "STOCK", isin: "INE002A01018", quantity: "10", averageBuyPrice: "2450.50", investedAmount: "24505.00", currentPrice: "2910.00" });
    expect(r.holdings[1].instrumentType).toBe("ETF");
  });

  it("mutual fund holdings with units to 3+ decimals", () => {
    const r = parseGrowwRows([
      ["Scheme Name", "AMC", "Category", "Sub-category", "Folio No.", "Source", "Units", "Invested Value", "Current Value", "Returns", "XIRR"],
      ["Parag Parikh Flexi Cap Fund Direct Growth", "PPFAS", "Equity", "Flexi Cap", "12345678", "Groww", "561.234", "45,000", "50,021.40", "5,021.40", "12.5%"],
    ]);
    expect(r.holdings[0]).toMatchObject({ instrumentType: "MUTUAL_FUND", quantity: "561.234", investedAmount: "45000.00", currentValue: "50021.40" });
    expect(r.holdings[0].averageBuyPrice).toBe("80.1805");
  });

  it("order history: executed only, sells, ids, date-time cells", () => {
    const r = parseGrowwRows([
      ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange", "Exchange Order Id", "Execution date and time", "Order status"],
      ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "BUY", "5", "17,250.00", "NSE", "1100000012345678", "05-08-2026 10:12 AM", "Executed"],
      ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "SELL", "2", "7,400.00", "NSE", "1100000012349999", "06-09-2026 02:30 PM", "Executed"],
      ["INFOSYS", "INFY", "INE009A01021", "BUY", "3", "4,500.00", "NSE", "1100000012350000", "07-09-2026 11:00 AM", "Cancelled"],
    ]);
    expect(r.kind).toBe("TRANSACTIONS");
    expect(r.transactions).toHaveLength(2);
    expect(r.transactions[0]).toMatchObject({ type: "BUY", quantity: "5", amount: "17250.00", price: "3450", externalId: "GROWW:1100000012345678" });
    expect(r.transactions[1].tradeDate.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(r.skipped[0].reason).toContain("Cancelled");
  });

  it("MF transactions: SIP and redemption", () => {
    const r = parseGrowwRows([
      ["Scheme Name", "Transaction Type", "Units", "NAV", "Amount", "Date"],
      ["Axis Bluechip Fund Direct Growth", "SIP Purchase", "98.765", "50.6250", "5,000.00", "05 Aug 2026"],
      ["Axis Bluechip Fund Direct Growth", "Redemption", "20.000", "55.0000", "1,100.00", "15 Sep 2026"],
    ]);
    expect(r.transactions.map((x) => x.type)).toEqual(["SIP", "REDEMPTION"]);
    expect(r.transactions[0].externalId).toMatch(/^GROWW:[0-9a-f]{32}$/);
  });

  it("rejects files without a recognisable table", () => {
    expect(() => parseGrowwRows([["hello", "world"], ["1", "2"]])).toThrow(/header/);
  });
});
