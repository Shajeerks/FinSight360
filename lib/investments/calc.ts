import { Decimal, roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

/**
 * Portfolio maths (pure, unit-tested). Quantities/prices use Decimal; only the
 * XIRR *rate* is solved in floating point (it's a ratio, not money).
 *
 * Cost basis: weighted average (how Indian brokers / CAS statements report
 * mutual funds and how Groww shows "average price"). A sale realises
 * (sale value − charges) − average cost × units.
 */

export type InvTxnType = "BUY" | "SELL" | "SIP" | "DIVIDEND" | "SWITCH_IN" | "SWITCH_OUT" | "BONUS" | "SPLIT" | "REDEMPTION";

export type InvTxn = { type: InvTxnType; tradeDate: Date; quantity: MoneyInput; price: MoneyInput; amount: MoneyInput; charges?: MoneyInput };

export type Position = {
  quantity: Decimal;
  averageBuyPrice: Decimal;
  investedAmount: Decimal;
  realizedGainLoss: Decimal;
  dividends: Decimal;
};

const ADDS: InvTxnType[] = ["BUY", "SIP", "SWITCH_IN"];
const REMOVES: InvTxnType[] = ["SELL", "SWITCH_OUT", "REDEMPTION"];
const FREE_UNITS: InvTxnType[] = ["BONUS", "SPLIT"];

export class PositionError extends Error {}

const order = (t: InvTxn) => (ADDS.includes(t.type) || FREE_UNITS.includes(t.type) ? 0 : t.type === "DIVIDEND" ? 1 : 2);

/** Replay transactions (date order; buys before sells on the same day). */
export function computePosition(txns: InvTxn[]): Position {
  const sorted = [...txns].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime() || order(a) - order(b));
  let qty = new Decimal(0);
  let cost = new Decimal(0); // total cost of units held
  let realized = new Decimal(0);
  let dividends = new Decimal(0);
  for (const t of sorted) {
    const q = toDecimal(t.quantity);
    const amount = toDecimal(t.amount);
    const charges = toDecimal(t.charges ?? 0);
    if (ADDS.includes(t.type)) {
      qty = qty.plus(q);
      cost = cost.plus(amount).plus(charges); // charges are part of the cost
    } else if (FREE_UNITS.includes(t.type)) {
      qty = qty.plus(q); // extra units at zero cost → average price falls
    } else if (REMOVES.includes(t.type)) {
      if (q.greaterThan(qty.plus("0.000001"))) {
        throw new PositionError(`Selling ${q.toString()} units but only ${qty.toDecimalPlaces(6).toString()} are held on ${t.tradeDate.toISOString().slice(0, 10)}.`);
      }
      const avg = qty.isZero() ? new Decimal(0) : cost.dividedBy(qty);
      const costOut = avg.times(q);
      realized = realized.plus(amount.minus(charges).minus(costOut));
      qty = qty.minus(q);
      cost = cost.minus(costOut);
      if (qty.abs().lessThan("0.000001")) {
        qty = new Decimal(0);
        cost = new Decimal(0);
      }
    } else if (t.type === "DIVIDEND") {
      dividends = dividends.plus(amount.minus(charges));
    }
  }
  return {
    quantity: qty.toDecimalPlaces(6),
    averageBuyPrice: qty.isZero() ? new Decimal(0) : cost.dividedBy(qty).toDecimalPlaces(4),
    investedAmount: roundMoney(cost),
    realizedGainLoss: roundMoney(realized),
    dividends: roundMoney(dividends),
  };
}

export type HoldingValue = { invested: Decimal; current: Decimal; gain: Decimal; gainPct: Decimal | null };

/** Current value = units × latest price (falls back to invested when no price is known). */
export function valueHolding(h: { quantity: MoneyInput; investedAmount: MoneyInput; currentPrice?: MoneyInput | null; currentValue?: MoneyInput | null }): HoldingValue {
  const invested = roundMoney(toDecimal(h.investedAmount));
  const current =
    h.currentPrice !== null && h.currentPrice !== undefined
      ? roundMoney(toDecimal(h.quantity).times(toDecimal(h.currentPrice)))
      : h.currentValue !== null && h.currentValue !== undefined
        ? roundMoney(toDecimal(h.currentValue))
        : invested;
  const gain = roundMoney(current.minus(invested));
  return { invested, current, gain, gainPct: invested.isZero() ? null : gain.dividedBy(invested).times(100).toDecimalPlaces(2) };
}

export type CashFlow = { date: Date; amount: number };

/**
 * XIRR: annualised internal rate of return for irregular cash flows
 * (investments negative, redemptions/dividends/current value positive).
 * Newton–Raphson with a bisection fallback. Returns a percentage or null.
 */
export function xirr(flows: CashFlow[]): number | null {
  const f = flows.filter((c) => c.amount !== 0).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (f.length < 2 || !f.some((c) => c.amount < 0) || !f.some((c) => c.amount > 0)) return null;
  const t0 = f[0].date.getTime();
  const years = f.map((c) => (c.date.getTime() - t0) / (365 * 86_400_000));
  if (years[years.length - 1] < 1 / 365) return null; // less than a day of history
  const npv = (r: number) => f.reduce((s, c, i) => s + c.amount / Math.pow(1 + r, years[i]), 0);
  const dnpv = (r: number) => f.reduce((s, c, i) => s - (years[i] * c.amount) / Math.pow(1 + r, years[i] + 1), 0);
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    const v = npv(r);
    const d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-10) return Math.round(next * 10000) / 100;
    r = next;
  }
  // Bisection on [-99.99%, 10000%].
  let lo = -0.9999;
  let hi = 100;
  let vlo = npv(lo);
  if (vlo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const vm = npv(mid);
    if (Math.abs(vm) < 1e-7) return Math.round(mid * 10000) / 100;
    if (vlo * vm < 0) hi = mid;
    else {
      lo = mid;
      vlo = vm;
    }
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

/** Cash flows of one holding's transactions, from the investor's point of view. */
export function cashFlowsOf(txns: InvTxn[]): CashFlow[] {
  return txns.flatMap((t) => {
    const amt = toDecimal(t.amount);
    const ch = toDecimal(t.charges ?? 0);
    if (ADDS.includes(t.type)) return [{ date: t.tradeDate, amount: -amt.plus(ch).toNumber() }];
    if (REMOVES.includes(t.type) || t.type === "DIVIDEND") return [{ date: t.tradeDate, amount: amt.minus(ch).toNumber() }];
    return [];
  });
}

/** Stable key for an instrument: ISIN, else exchange symbol, else normalised name. */
export function instrumentKeyOf(i: { isin?: string | null; symbol?: string | null; instrumentName: string }): string {
  const isin = i.isin?.trim().toUpperCase();
  if (isin && /^IN[A-Z0-9]{10}$/.test(isin)) return `ISIN:${isin}`;
  const sym = i.symbol?.trim().toUpperCase();
  if (sym) return `SYM:${sym}`;
  return `NAME:${i.instrumentName.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}`;
}

/** AMFI NAVAll.txt → ISIN → { nav, date }. Lines: code;ISIN growth/payout;ISIN reinvest;name;NAV;dd-MMM-yyyy */
export function parseAmfiNav(text: string): Map<string, { nav: string; date: Date; name: string }> {
  const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const out = new Map<string, { nav: string; date: Date; name: string }>();
  for (const line of text.split(/\r?\n/)) {
    const p = line.split(";");
    if (p.length < 6 || !/^\d+$/.test(p[0].trim())) continue;
    const nav = p[4].trim();
    if (!/^\d+(\.\d+)?$/.test(nav)) continue;
    const dm = p[5].trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!dm || MONTHS[dm[2].toLowerCase()] === undefined) continue;
    const date = new Date(Date.UTC(+dm[3], MONTHS[dm[2].toLowerCase()], +dm[1]));
    for (const isin of [p[1], p[2]].map((x) => x.trim().toUpperCase())) {
      if (/^IN[A-Z0-9]{10}$/.test(isin)) out.set(isin, { nav, date, name: p[3].trim() });
    }
  }
  return out;
}
