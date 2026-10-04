import { createHash } from "node:crypto";
import type { ProviderHolding, ProviderTransaction } from "@/providers/investments/types";
import { detectDateFormat, parseAmount, parseDateWith } from "@/lib/import/values";
import { toDecimal } from "@/lib/money";

/**
 * Parser for files exported from Groww (and similar brokers/CAS tools):
 * stock or mutual-fund HOLDINGS reports and order / transaction HISTORY.
 * Columns are matched by name (Groww tweaks its layouts), so it also works
 * with most broker exports. Pure — unit-tested with sample sheets.
 */

type Field = "name" | "isin" | "symbol" | "quantity" | "avg" | "invested" | "currentPrice" | "currentValue" | "type" | "date" | "price" | "amount" | "orderId" | "status" | "category";

const SYN: Record<Field, string[]> = {
  name: ["stock name", "scheme name", "instrument", "security name", "company name", "fund name", "name", "stock", "scheme", "security"],
  isin: ["isin", "isin code"],
  symbol: ["symbol", "ticker", "nse symbol", "trading symbol", "bse code", "scrip"],
  quantity: ["quantity", "qty", "units", "balance units", "no of units", "shares", "quantity available"],
  avg: ["average buy price", "avg price", "average price", "avg. price", "avg cost", "average cost", "avg nav", "average nav", "purchase nav", "avg buy price", "buy avg"],
  invested: ["buy value", "invested value", "invested amount", "cost value", "total investment", "purchase value", "investment", "invested"],
  currentPrice: ["closing price", "ltp", "current price", "current nav", "market price", "latest nav", "last price"],
  currentValue: ["closing value", "current value", "market value", "present value", "valuation"],
  type: ["type", "transaction type", "order type", "side", "buy/sell", "trade type", "txn type"],
  date: ["date", "execution date and time", "trade date", "transaction date", "order date", "execution date", "date and time", "order execution time"],
  price: ["price", "nav", "rate", "trade price", "execution price", "avg. price per unit", "price per unit", "purchase price"],
  amount: ["value", "amount", "order value", "trade value", "total amount", "net amount", "transaction amount"],
  orderId: ["exchange order id", "order id", "trade id", "transaction id", "order number", "reference id"],
  status: ["order status", "status"],
  category: ["category", "asset class", "sub-category", "sub category", "instrument type"],
};

const cleanIsin = (v: string | undefined) => {
  const s = v?.trim().toUpperCase() ?? "";
  return /^IN[A-Z0-9]{10}$/.test(s) ? s : null;
};
const cleanSymbol = (v: string | undefined) => {
  const s = v?.trim().toUpperCase().replace(/[^A-Z0-9&._-]/g, "") ?? "";
  return s ? s.slice(0, 20) : null;
};
/** Keeps values inside the database's Decimal(18,2/4) columns. */
const tooBig = (...vals: (string | null | undefined)[]) => vals.some((v) => v !== null && v !== undefined && Math.abs(Number(v)) >= 1e12);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9/(). ]/g, "").trim();

function fieldOf(h: string): Field | null {
  const n = norm(h);
  if (!n) return null;
  for (const [f, list] of Object.entries(SYN) as [Field, string[]][]) if (list.includes(n)) return f;
  return null;
}

function mapHeader(row: string[]) {
  const m: Partial<Record<Field, number>> = {};
  row.forEach((h, i) => {
    const f = fieldOf(h);
    if (f && m[f] === undefined) m[f] = i;
  });
  return m;
}

export type GrowwParseResult = {
  kind: "HOLDINGS" | "TRANSACTIONS";
  holdings: ProviderHolding[];
  transactions: ProviderTransaction[];
  skipped: { row: number; reason: string }[];
  headerRow: number;
};

export class GrowwFileError extends Error {}

function num(v: string | undefined): string | null {
  if (v === undefined) return null;
  const a = parseAmount(v.replace(/[()]/g, (c) => (c === "(" ? "-" : "")));
  return a ? a.amount : (/^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : null);
}

/** Units can have up to 6 decimals (mutual funds) — parseAmount caps at 2, so handle them separately. */
function units(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/,/g, "").trim();
  return /^-?\d+(\.\d{1,6})?$/.test(s) ? s : null;
}

function price4(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.replace(/[₹,\s]|Rs\.?|INR/gi, "").trim();
  return /^\d+(\.\d{1,6})?$/.test(s) ? s : null;
}

function instrumentTypeOf(name: string, headerText: string, category: string | undefined): ProviderHolding["instrumentType"] {
  const n = `${name} ${category ?? ""}`.toUpperCase();
  if (/\bETF\b|BEES\b/.test(n)) return "ETF";
  if (/\bGOLD\b/.test(n) && !/FUND/.test(n)) return "GOLD";
  if (/\bBOND|DEBENTURE|NCD\b|SGB\b/.test(n)) return "BOND";
  if (/FUND|SCHEME|\bPLAN\b|GROWTH|IDCW|DIRECT/.test(n) || /scheme|folio|units|nav/.test(headerText)) return "MUTUAL_FUND";
  return "STOCK";
}

function txnTypeOf(raw: string, isMf: boolean): ProviderTransaction["type"] | null {
  const t = raw.toUpperCase();
  if (/SWITCH\s*-?\s*IN/.test(t)) return "SWITCH_IN";
  if (/SWITCH\s*-?\s*OUT/.test(t)) return "SWITCH_OUT";
  if (/\bSIP\b|SYSTEMATIC/.test(t)) return "SIP";
  if (/BONUS/.test(t)) return "BONUS";
  if (/SPLIT/.test(t)) return "SPLIT";
  if (/DIVIDEND|IDCW|\bDIV\b/.test(t)) return "DIVIDEND";
  if (/REDEEM|REDEMPTION|WITHDRAW/.test(t)) return "REDEMPTION";
  if (/\bSELL\b|^S$/.test(t)) return isMf ? "REDEMPTION" : "SELL";
  if (/\bBUY\b|PURCHASE|LUMPSUM|INVEST|^B$/.test(t)) return "BUY";
  return null;
}

/** "05 Oct 2026, 10:12 AM" / "2026-10-05 10:12:00" / "05-10-2026" → the date part. */
function datePart(v: string) {
  return v.replace(/,?\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?.*$/i, "").replace(/T.*$/, "").trim();
}

export function parseGrowwRows(rows: string[][]): GrowwParseResult {
  let headerRow = -1;
  let map: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const m = mapHeader(rows[i]);
    if (m.name !== undefined && (m.quantity !== undefined || m.amount !== undefined) && Object.keys(m).length >= 3) {
      headerRow = i;
      map = m;
      break;
    }
  }
  if (headerRow < 0) throw new GrowwFileError("Couldn't find the table header. Upload the holdings or order-history file exactly as downloaded from Groww.");
  const headerText = rows[headerRow].join(" ").toLowerCase();
  const isTxn = map.type !== undefined && map.date !== undefined;
  const data = rows.slice(headerRow + 1);
  const cell = (r: string[], f: Field) => (map[f] === undefined ? undefined : (r[map[f]!] ?? "").trim());
  const skipped: GrowwParseResult["skipped"] = [];

  if (!isTxn) {
    if (map.quantity === undefined || (map.avg === undefined && map.invested === undefined)) {
      throw new GrowwFileError("This file has no quantity / average price columns. Use Groww → Reports → Holdings statement.");
    }
    const holdings: ProviderHolding[] = [];
    data.forEach((r, i) => {
      const name = cell(r, "name");
      if (!name || /^(total|grand total)/i.test(name)) return;
      const qty = units(cell(r, "quantity"));
      if (!qty || toDecimal(qty).lessThanOrEqualTo(0)) return void skipped.push({ row: headerRow + i + 2, reason: "No quantity" });
      let avg = price4(cell(r, "avg"));
      let invested = num(cell(r, "invested"));
      if (!avg && !invested) return void skipped.push({ row: headerRow + i + 2, reason: "No average price or invested value" });
      if (!invested) invested = toDecimal(avg!).times(qty).toDecimalPlaces(2).toFixed(2);
      if (!avg) avg = toDecimal(invested).dividedBy(qty).toDecimalPlaces(4).toString();
      const cp = price4(cell(r, "currentPrice"));
      const cv = num(cell(r, "currentValue"));
      if (tooBig(qty, avg, invested, cp, cv) || toDecimal(qty).times(cp ?? avg).greaterThanOrEqualTo(1e14)) return void skipped.push({ row: headerRow + i + 2, reason: "Value out of range" });
      holdings.push({
        instrumentName: name.slice(0, 160),
        instrumentType: instrumentTypeOf(name, headerText, cell(r, "category")),
        isin: cleanIsin(cell(r, "isin")),
        symbol: cleanSymbol(cell(r, "symbol")),
        quantity: qty,
        averageBuyPrice: avg,
        investedAmount: invested,
        currentPrice: cp ?? (cv ? toDecimal(cv).dividedBy(qty).toDecimalPlaces(4).toString() : null),
        currentValue: cv,
      });
    });
    return { kind: "HOLDINGS", holdings, transactions: [], skipped, headerRow };
  }

  const fmt = detectDateFormat(data.map((r) => datePart(cell(r, "date") ?? "")).filter(Boolean).slice(0, 50));
  const transactions: ProviderTransaction[] = [];
  const seen = new Map<string, number>();
  data.forEach((r, i) => {
    const rowNo = headerRow + i + 2;
    const name = cell(r, "name");
    if (!name || /^(total|grand total)/i.test(name)) return;
    const status = cell(r, "status");
    if (status && !/^(executed|complete|completed|success|successful|allotted|processed|traded|filled)$/i.test(status)) return void skipped.push({ row: rowNo, reason: `Status "${status}"` });
    const isMf = instrumentTypeOf(name, headerText, cell(r, "category")) === "MUTUAL_FUND";
    const type = txnTypeOf(cell(r, "type") ?? "", isMf);
    if (!type) return void skipped.push({ row: rowNo, reason: `Unknown type "${cell(r, "type")}"` });
    const rawDate = datePart(cell(r, "date") ?? "");
    const tradeDate = (fmt && parseDateWith(rawDate, fmt)) || parseDateWith(rawDate, "yyyy-MM-dd") || parseDateWith(rawDate, "dd MMM yyyy");
    if (!tradeDate) return void skipped.push({ row: rowNo, reason: "Date not recognised" });
    const qty = units(cell(r, "quantity")) ?? (type === "DIVIDEND" ? "0" : null);
    let price = price4(cell(r, "price"));
    let amount = num(cell(r, "amount"));
    if (!qty) return void skipped.push({ row: rowNo, reason: "No quantity" });
    const q = toDecimal(qty).abs();
    if (!amount && price) amount = toDecimal(price).times(q).toDecimalPlaces(2).toFixed(2);
    if (!price && amount && !q.isZero()) price = toDecimal(amount).abs().dividedBy(q).toDecimalPlaces(4).toString();
    if (!amount) return void skipped.push({ row: rowNo, reason: "No amount or price" });
    if (tooBig(qty, price, amount)) return void skipped.push({ row: rowNo, reason: "Value out of range" });
    const amt = toDecimal(amount).abs();
    const orderId = cell(r, "orderId");
    const key = [name.toUpperCase(), tradeDate.toISOString().slice(0, 10), type, q.toString(), amt.toFixed(2)].join("|");
    const occ = (seen.get(key) ?? 0) + 1;
    seen.set(key, occ);
    transactions.push({
      instrumentType: instrumentTypeOf(name, headerText, cell(r, "category")),
      externalId: orderId && orderId !== "-" ? `GROWW:${orderId}` : `GROWW:${createHash("sha256").update(`${key}|${occ}`).digest("hex").slice(0, 32)}`,
      type,
      tradeDate,
      instrumentName: name.slice(0, 160),
      isin: cleanIsin(cell(r, "isin")),
      symbol: cleanSymbol(cell(r, "symbol")),
      quantity: q.toString(),
      price: price ?? "0",
      amount: amt.toFixed(2),
      charges: "0",
    });
  });
  return { kind: "TRANSACTIONS", holdings: [], transactions, skipped, headerRow };
}
