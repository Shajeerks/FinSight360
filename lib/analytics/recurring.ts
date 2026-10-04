import { Decimal, toDecimal, type MoneyInput } from "@/lib/money";

/**
 * Recurring-payment detection (pure, unit-tested).
 *
 * A series is recurring when the same payee shows up at a steady interval
 * (weekly / monthly / quarterly / yearly) with a similar amount. We use
 * medians so one odd payment doesn't break the pattern.
 */

export type RecurringInput = {
  key: string; // merchant id or normalised description
  name: string;
  transactionDate: Date;
  amount: MoneyInput;
  direction: "DEBIT" | "CREDIT";
};

export type Frequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export type RecurringSeries = {
  key: string;
  name: string;
  direction: "DEBIT" | "CREDIT";
  frequency: Frequency;
  expectedAmount: Decimal;
  amountVariationPct: number;
  occurrences: number;
  lastSeen: Date;
  nextDue: Date;
  dayOfMonth: number | null;
  confidence: number;
};

const DAY = 86_400_000;

const BANDS: { f: Frequency; days: number; min: number; max: number; minCount: number }[] = [
  { f: "WEEKLY", days: 7, min: 6, max: 8, minCount: 4 },
  { f: "MONTHLY", days: 30, min: 26, max: 35, minCount: 3 },
  { f: "QUARTERLY", days: 91, min: 84, max: 98, minCount: 3 },
  { f: "HALF_YEARLY", days: 182, min: 172, max: 192, minCount: 2 },
  { f: "YEARLY", days: 365, min: 350, max: 380, minCount: 2 },
];

function median(nums: number[]) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianDecimal(vals: Decimal[]) {
  const s = [...vals].sort((a, b) => a.comparedTo(b));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : s[m - 1].plus(s[m]).dividedBy(2).toDecimalPlaces(2);
}

export function addFrequency(d: Date, f: Frequency, anchorDay: number | null): Date {
  if (f === "WEEKLY") return new Date(d.getTime() + 7 * DAY);
  const months = f === "MONTHLY" ? 1 : f === "QUARTERLY" ? 3 : f === "HALF_YEARLY" ? 6 : 12;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = anchorDay ?? d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last)));
}

export function detectRecurring(items: RecurringInput[], opts: { tolerancePct?: number } = {}): RecurringSeries[] {
  const tol = opts.tolerancePct ?? 20;
  const groups = new Map<string, RecurringInput[]>();
  for (const it of items) {
    const k = `${it.direction}|${it.key}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  const out: RecurringSeries[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // One payment per day per payee (two coffees on one day are not a "series").
    const byDay = new Map<number, RecurringInput>();
    for (const x of list) {
      const t = x.transactionDate.getTime();
      const prev = byDay.get(t);
      if (!prev || toDecimal(x.amount).greaterThan(toDecimal(prev.amount))) byDay.set(t, x);
    }
    const sorted = [...byDay.values()].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
    if (sorted.length < 2) continue;
    const gaps = sorted.slice(1).map((x, i) => (x.transactionDate.getTime() - sorted[i].transactionDate.getTime()) / DAY);
    const gap = median(gaps);
    const band = BANDS.find((b) => gap >= b.min && gap <= b.max);
    if (!band || sorted.length < band.minCount) continue;
    // Most gaps must fit the band (allows one missed / late payment).
    const fitting = gaps.filter((g) => g >= band.min - 3 && g <= band.max + 3).length;
    if (fitting / gaps.length < 0.7) continue;
    const amounts = sorted.map((x) => toDecimal(x.amount));
    const expected = medianDecimal(amounts);
    if (expected.lessThanOrEqualTo(0)) continue;
    const within = amounts.filter((a) => a.minus(expected).abs().dividedBy(expected).times(100).lessThanOrEqualTo(tol)).length;
    if (within / amounts.length < 0.7) continue;
    const variation = Math.max(...amounts.map((a) => a.minus(expected).abs().dividedBy(expected).times(100).toNumber()));
    const last = sorted[sorted.length - 1];
    const dayOfMonth = band.f === "WEEKLY" ? null : Math.round(median(sorted.map((x) => x.transactionDate.getUTCDate())));
    let confidence = 50 + Math.min(sorted.length, 12) * 3 + (fitting / gaps.length) * 10 + (within / amounts.length) * 10;
    if (variation <= 2) confidence += 5;
    out.push({
      key: list[0].key,
      name: last.name,
      direction: last.direction,
      frequency: band.f,
      expectedAmount: expected,
      amountVariationPct: Math.round(variation * 10) / 10,
      occurrences: sorted.length,
      lastSeen: last.transactionDate,
      nextDue: addFrequency(last.transactionDate, band.f, dayOfMonth),
      dayOfMonth,
      confidence: Math.min(99, Math.round(confidence)),
    });
  }
  return out.sort((a, b) => b.expectedAmount.comparedTo(a.expectedAmount));
}

/** Monthly-equivalent cost, for "your recurring commitments add up to …". */
export function monthlyEquivalent(amount: MoneyInput, f: Frequency | "DAILY"): Decimal {
  const a = toDecimal(amount);
  const factor = { DAILY: 30, WEEKLY: 52 / 12, MONTHLY: 1, QUARTERLY: 1 / 3, HALF_YEARLY: 1 / 6, YEARLY: 1 / 12 }[f];
  return a.times(factor).toDecimalPlaces(2);
}
