import ExcelJS from "exceljs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  addInvestmentTransaction, createHolding, createInvestmentAccount, deleteInvestmentAccount, deleteInvestmentTransaction, getHoldingDetail, getPortfolio, refreshMutualFundNavs, updateHoldingPrice,
} from "@/services/investment.service";
import { importInvestmentFile } from "@/services/groww.service";
import { getDashboardData } from "@/services/dashboard.service";
import { meta, resetDatabase } from "./helpers";

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  rows.forEach((r) => ws.addRow(r));
  return { name: "groww.xlsx", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}

describe("Phase 6 investments (integration)", () => {
  let userId: string;
  let accountId: string;
  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "inv@example.com" } })).id;
    accountId = (await createInvestmentAccount(userId, { name: "Groww stocks", providerType: "GROWW", accountType: "DEMAT" }, meta)).id;
  });
  afterAll(() => prisma.$disconnect());

  it("transactions drive the holding: average cost, realised gain, value, XIRR; deleting replays", async () => {
    await addInvestmentTransaction(userId, { investmentAccountId: accountId, instrumentName: "Tata Consultancy Services", instrumentType: "STOCK", symbol: "tcs", type: "BUY", tradeDate: "2025-10-01", quantity: "10", price: "3000", charges: "20" }, meta);
    const h0 = await prisma.investmentHolding.findFirstOrThrow({ where: { userId } });
    await addInvestmentTransaction(userId, { investmentAccountId: accountId, holdingId: h0.id, type: "BUY", tradeDate: "2026-01-10", quantity: "10", price: "3400" }, meta);
    const sell = await addInvestmentTransaction(userId, { investmentAccountId: accountId, holdingId: h0.id, type: "SELL", tradeDate: "2026-06-01", quantity: "5", amount: "18500" }, meta);
    let h = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h0.id } });
    expect(h.quantity.toString()).toBe("15");
    expect(h.averageBuyPrice.toString()).toBe("3201");
    expect(h.investedAmount.toFixed(2)).toBe("48015.00");
    expect(h.realizedGainLoss.toFixed(2)).toBe("2495.00"); // 18500 − 5 × 3201
    await updateHoldingPrice(userId, h0.id, { currentPrice: "3600" }, meta);
    const d = await getHoldingDetail(userId, h0.id);
    expect(d.value.current.toFixed(2)).toBe("54000.00");
    expect(d.xirr).not.toBeNull();
    await expect(addInvestmentTransaction(userId, { investmentAccountId: accountId, holdingId: h0.id, type: "SELL", tradeDate: "2026-07-01", quantity: "50", price: "3600" }, meta)).rejects.toMatchObject({ code: "OVERSOLD" });
    await deleteInvestmentTransaction(userId, sell.id, meta);
    h = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h0.id } });
    expect(h.quantity.toString()).toBe("20");
    expect(h.realizedGainLoss.toFixed(2)).toBe("0.00");
    expect(h.currentValue?.toFixed(2)).toBe("72000.00");
  });

  it("a holding entered as a snapshot keeps its position when transactions are added", async () => {
    const h = await createHolding(userId, { investmentAccountId: accountId, instrumentName: "Parag Parikh Flexi Cap Fund Direct Growth", instrumentType: "MUTUAL_FUND", isin: "INF879O01027", quantity: "500.123", investedAmount: "40000", currentPrice: "89.50" }, meta);
    expect(h.currentValue?.toFixed(2)).toBe("44761.01");
    await expect(createHolding(userId, { investmentAccountId: accountId, instrumentName: "PPFAS", instrumentType: "MUTUAL_FUND", isin: "INF879O01027", quantity: "1", investedAmount: "1" }, meta)).rejects.toMatchObject({ code: "HOLDING_EXISTS" });
    await addInvestmentTransaction(userId, { investmentAccountId: accountId, holdingId: h.id, type: "SIP", tradeDate: "2026-09-05", quantity: "55.877", amount: "5000" }, meta);
    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } });
    expect(after.quantity.toString()).toBe("556");
    expect(after.investedAmount.toFixed(2)).toBe("45000.00");
    expect(await prisma.investmentTransaction.count({ where: { holdingId: h.id, notes: { contains: "Opening position" } } })).toBe(1);
  });

  it("AMFI NAV refresh updates mutual funds by ISIN", async () => {
    await createHolding(userId, { investmentAccountId: accountId, instrumentName: "PPFAS Flexi Cap", instrumentType: "MUTUAL_FUND", isin: "INF879O01027", quantity: "100", averageBuyPrice: "80" }, meta);
    await createHolding(userId, { investmentAccountId: accountId, instrumentName: "Unknown fund", instrumentType: "MUTUAL_FUND", isin: "INF000Z01011", quantity: "10", averageBuyPrice: "10" }, meta);
    const r = await refreshMutualFundNavs(userId, meta, async () => "Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;91.2500;03-Oct-2026\n");
    expect(r).toEqual({ updated: 1, notFound: 1, asOf: "2026-10-03" });
    const h = await prisma.investmentHolding.findFirstOrThrow({ where: { isin: "INF879O01027" } });
    expect(h.currentValue?.toFixed(2)).toBe("9125.00");
    await expect(refreshMutualFundNavs(userId, meta, async () => { throw new Error("offline"); })).rejects.toMatchObject({ code: "NAV_UNAVAILABLE" });
  });

  it("Groww holdings statement: preview, commit, re-import is a no-op, sold positions removed", async () => {
    const file = await xlsx([
      ["Holdings statement for stocks"],
      [],
      ["Stock Name", "ISIN", "Quantity", "Average buy price", "Buy value", "Closing price", "Closing value", "Unrealised P&L"],
      ["RELIANCE INDUSTRIES LTD", "INE002A01018", 10, 2450.5, 24505, 2910, 29100, 4595],
      ["NIPPON INDIA ETF NIFTY BEES", "INF204KB14I2", 50, 240.1, 12005, 265, 13250, 1245],
    ]);
    const preview = await importInvestmentFile(userId, accountId, file, { commit: false }, meta);
    expect(preview).toMatchObject({ kind: "HOLDINGS", committed: false });
    expect(preview.holdings.map((h) => h.action)).toEqual(["NEW", "NEW"]);
    expect(await prisma.investmentHolding.count()).toBe(0);
    await importInvestmentFile(userId, accountId, file, { commit: true }, meta);
    const p = await getPortfolio(userId);
    expect(p.totals.invested.toFixed(2)).toBe("36510.00");
    expect(p.totals.current.toFixed(2)).toBe("42350.00");
    expect(p.allocation.map((a) => a.type).sort()).toEqual(["ETF", "STOCK"]);
    const again = await importInvestmentFile(userId, accountId, file, { commit: false }, meta);
    expect(again.holdings.every((h) => h.action === "UNCHANGED")).toBe(true);
    const sold = await xlsx([["Stock Name", "ISIN", "Quantity", "Average buy price", "Closing price"], ["RELIANCE INDUSTRIES LTD", "INE002A01018", 10, 2450.5, 2950]]);
    const r = await importInvestmentFile(userId, accountId, sold, { commit: true, removeMissing: true }, meta);
    expect(r.removed.map((x) => x.name)).toEqual(["NIPPON INDIA ETF NIFTY BEES"]);
    expect((await getPortfolio(userId)).totals.current.toFixed(2)).toBe("29500.00");
    expect(await prisma.growwSyncJob.count()).toBe(2);
    // Net worth on the dashboard includes investments and drops them when the account is removed.
    const ym = { year: 2026, month: 10 };
    expect((await getDashboardData(userId, ym)).netWorth.investments.toFixed(2)).toBe("29500.00");
    await deleteInvestmentAccount(userId, accountId, meta);
    expect((await getDashboardData(userId, ym)).netWorth.investments.toFixed(2)).toBe("0.00");
  });

  it("Groww order history: dedupes by order id across uploads and rejects incomplete history", async () => {
    const orders = await xlsx([
      ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange", "Exchange Order Id", "Execution date and time", "Order status"],
      ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "BUY", 5, 17250, "NSE", "1100000012345678", "05-08-2026 10:12 AM", "Executed"],
      ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "SELL", 2, 7400, "NSE", "1100000012349999", "06-09-2026 02:30 PM", "Executed"],
    ]);
    const first = await importInvestmentFile(userId, accountId, orders, { commit: true }, meta);
    expect(first.transactions.filter((t) => !t.duplicate)).toHaveLength(2);
    const h = await prisma.investmentHolding.findFirstOrThrow({ where: { symbol: "TCS" } });
    expect(h.quantity.toString()).toBe("3");
    expect(h.realizedGainLoss.toFixed(2)).toBe("500.00"); // 7400 − 2 × 3450
    const second = await importInvestmentFile(userId, accountId, orders, { commit: true }, meta);
    expect(second.transactions.every((t) => t.duplicate)).toBe(true);
    expect(await prisma.investmentTransaction.count()).toBe(2);

    const onlySell = await xlsx([
      ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange Order Id", "Execution date and time", "Order status"],
      ["INFOSYS", "INFY", "INE009A01021", "SELL", 3, 4500, "1100000099999999", "07-09-2026 11:00 AM", "Executed"],
    ]);
    await expect(importInvestmentFile(userId, accountId, onlySell, { commit: true }, meta)).rejects.toMatchObject({ code: "INCOMPLETE_HISTORY" });
    expect(await prisma.investmentTransaction.count()).toBe(2); // rolled back
  });

  it("ownership and file checks", async () => {
    const other = (await prisma.user.create({ data: { email: "o@example.com" } })).id;
    await expect(createHolding(other, { investmentAccountId: accountId, instrumentName: "X Fund", instrumentType: "MUTUAL_FUND", quantity: "1", averageBuyPrice: "1" }, meta)).rejects.toMatchObject({ status: 404 });
    await expect(importInvestmentFile(userId, accountId, { name: "a.pdf", buffer: Buffer.from("%PDF-1.4") }, { commit: false }, meta)).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(importInvestmentFile(userId, accountId, await xlsx([["a", "b"], ["1", "2"]]), { commit: false }, meta)).rejects.toMatchObject({ code: "UNRECOGNISED_FILE" });
  });
});
