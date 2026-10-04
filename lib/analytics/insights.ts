import { Decimal, roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

/** Spending-intelligence helpers (pure, unit-tested). */

export type CategoryAmount = { id: string; name: string; amount: MoneyInput };

export type CategoryTrend = {
  id: string;
  name: string;
  current: Decimal;
  previous: Decimal;
  average3: Decimal;
  changePct: number | null; // vs previous month
  vsAveragePct: number | null; // vs the 3 months before
  share: number; // % of this month's spending
};

const pct = (a: Decimal, b: Decimal) => (b.isZero() ? null : Math.round(a.minus(b).dividedBy(b).times(1000).toNumber()) / 10);

export function categoryTrends(current: CategoryAmount[], previous: CategoryAmount[], last3: CategoryAmount[][]): CategoryTrend[] {
  const ids = new Map<string, string>();
  [current, previous, ...last3].flat().forEach((c) => ids.set(c.id, c.name));
  const sumOf = (list: CategoryAmount[], id: string) => list.filter((c) => c.id === id).reduce((a, c) => a.plus(toDecimal(c.amount)), new Decimal(0));
  const total = current.reduce((a, c) => a.plus(toDecimal(c.amount)), new Decimal(0));
  return [...ids.entries()]
    .map(([id, name]) => {
      const cur = sumOf(current, id);
      const prev = sumOf(previous, id);
      const avg = last3.length ? last3.reduce((a, m) => a.plus(sumOf(m, id)), new Decimal(0)).dividedBy(last3.length) : new Decimal(0);
      return {
        id,
        name,
        current: roundMoney(cur),
        previous: roundMoney(prev),
        average3: roundMoney(avg),
        changePct: pct(cur, prev),
        vsAveragePct: pct(cur, avg),
        share: total.isZero() ? 0 : Math.round(cur.dividedBy(total).times(1000).toNumber()) / 10,
      };
    })
    .filter((t) => t.current.greaterThan(0) || t.previous.greaterThan(0) || t.average3.greaterThan(0))
    .sort((a, b) => b.current.comparedTo(a.current));
}

export type TxnForUnusual = {
  id: string;
  transactionDate: Date;
  amount: MoneyInput;
  description: string;
  merchantKey: string | null;
  categoryId: string | null;
};

export type UnusualTxn = TxnForUnusual & { reasons: string[]; score: number };

/**
 * Flags this period's transactions that stand out against the user's own history:
 *  • large: ≥ ₹10,000 and ≥ 3× the typical (median) amount in its category
 *  • spike: more than 3 standard deviations above the category mean
 *  • new payee: first time this merchant appears, for a meaningful amount (≥ ₹2,000)
 */
export function findUnusual(current: TxnForUnusual[], history: TxnForUnusual[], opts: { largeAbs?: number; newMerchantMin?: number } = {}): UnusualTxn[] {
  const largeAbs = opts.largeAbs ?? 10_000;
  const newMin = opts.newMerchantMin ?? 2_000;
  const byCat = new Map<string, number[]>();
  for (const h of history) {
    const k = h.categoryId ?? "_";
    byCat.set(k, [...(byCat.get(k) ?? []), toDecimal(h.amount).toNumber()]);
  }
  const seenMerchants = new Set(history.map((h) => h.merchantKey).filter(Boolean));
  const out: UnusualTxn[] = [];
  for (const t of current) {
    const amt = toDecimal(t.amount).toNumber();
    const hist = byCat.get(t.categoryId ?? "_") ?? [];
    const reasons: string[] = [];
    let score = 0;
    if (hist.length >= 3) {
      const sorted = [...hist].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
      const sd = Math.sqrt(hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length);
      if (amt >= largeAbs && med > 0 && amt >= 3 * med) {
        reasons.push(`${Math.round(amt / med)}× your usual amount in this category`);
        score += 2;
      } else if (sd > 0 && amt > mean + 3 * sd && amt >= newMin) {
        reasons.push("Much higher than usual for this category");
        score += 1;
      }
    } else if (amt >= largeAbs * 2.5) {
      reasons.push("Large payment");
      score += 1;
    }
    if (t.merchantKey && !seenMerchants.has(t.merchantKey) && amt >= newMin && history.length >= 10) {
      reasons.push("First payment to this merchant");
      score += 1;
    }
    if (reasons.length) out.push({ ...t, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score || toDecimal(b.amount).comparedTo(toDecimal(a.amount)));
}

export type Ratios = { savingsRate: number | null; investmentRate: number | null; emiRate: number | null; expenseRate: number | null };

export function ratios(m: { income: MoneyInput; expenses: MoneyInput; emi: MoneyInput; investments: MoneyInput; savings: MoneyInput }): Ratios {
  const inc = toDecimal(m.income);
  const r = (v: MoneyInput) => (inc.isZero() ? null : Math.round(toDecimal(v).dividedBy(inc).times(1000).toNumber()) / 10);
  return { savingsRate: r(m.savings), investmentRate: r(m.investments), emiRate: r(m.emi), expenseRate: r(m.expenses) };
}

/** Plain-language tips from the numbers (never advice to buy/sell anything). */
export function ratioTips(r: Ratios): { tone: "positive" | "warning" | "neutral"; text: string }[] {
  const tips: { tone: "positive" | "warning" | "neutral"; text: string }[] = [];
  if (r.emiRate !== null && r.emiRate > 40) tips.push({ tone: "warning", text: `EMIs take ${r.emiRate}% of income — above the commonly used 40% comfort limit.` });
  else if (r.emiRate !== null && r.emiRate > 0) tips.push({ tone: "neutral", text: `EMIs take ${r.emiRate}% of income.` });
  if (r.savingsRate !== null && r.savingsRate < 0) tips.push({ tone: "warning", text: "You spent more than you earned this month." });
  else if (r.savingsRate !== null && r.savingsRate >= 20) tips.push({ tone: "positive", text: `You kept ${r.savingsRate}% of your income.` });
  if (r.investmentRate !== null && r.investmentRate >= 10) tips.push({ tone: "positive", text: `${r.investmentRate}% of income went into investments.` });
  return tips;
}
