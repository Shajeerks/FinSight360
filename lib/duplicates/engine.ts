import { toDecimal, type MoneyInput } from "@/lib/money";
import { merchantKey, normalizeDescription } from "@/lib/transactions/normalize";

/**
 * Duplicate detection (spec §10).
 *
 * The same real-world transaction can arrive from email, SMS, a bank statement,
 * a card statement or manual entry. We score a pair 0–100:
 *   ≥ 95  high-confidence duplicate → safe automatic match (sources merged)
 *   70–94 possible duplicate        → user review
 *   < 70  probably unique
 * Hard rules: amount, currency and direction must match exactly, the dates must
 * be within 3 days, and the transactions must not be on different accounts.
 */
export const AUTO_MATCH_THRESHOLD = 95;
export const REVIEW_THRESHOLD = 70;
export const MAX_DAY_GAP = 3;

export type DuplicateComparable = {
  /** Account refs the transaction touches, e.g. ["card:abc"] or ["bank:x","card:y"] for a card bill payment. */
  accountRefs: string[];
  transactionDate: Date;
  transactionAt?: Date | null;
  amount: MoneyInput;
  direction: "DEBIT" | "CREDIT";
  currency?: string;
  referenceNumber?: string | null;
  merchantName?: string | null;
  description: string;
  /** Card bill payments appear as a bank debit and a card credit — direction is ignored for them. */
  isCardPayment?: boolean;
};

export type DuplicateScore = { score: number; matchedFields: string[]; reasons: string[] };

const DAY = 86_400_000;

function tokens(s: string): Set<string> {
  return new Set(normalizeDescription(s).split(" ").filter((t) => t.length > 2 && !/^\d+$/.test(t)));
}

export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function cleanRef(r?: string | null) {
  return (r ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function scoreDuplicate(a: DuplicateComparable, b: DuplicateComparable): DuplicateScore {
  const none: DuplicateScore = { score: 0, matchedFields: [], reasons: [] };
  const matched: string[] = [];
  const reasons: string[] = [];

  // ── hard requirements ──
  if ((a.currency ?? "INR") !== (b.currency ?? "INR")) return { ...none, reasons: ["Different currency"] };
  if (!toDecimal(a.amount).equals(toDecimal(b.amount))) return { ...none, reasons: ["Different amount"] };
  const directionIgnored = Boolean(a.isCardPayment || b.isCardPayment);
  if (!directionIgnored && a.direction !== b.direction) return { ...none, reasons: ["Different direction"] };
  const dayGap = Math.abs(Math.round((a.transactionDate.getTime() - b.transactionDate.getTime()) / DAY));
  if (dayGap > MAX_DAY_GAP) return { ...none, reasons: [`${dayGap} days apart`] };

  let score = 0;
  // Account / card
  const shared = a.accountRefs.some((r) => b.accountRefs.includes(r));
  if (shared) {
    score += 25;
    matched.push("account");
  } else if (a.accountRefs.length && b.accountRefs.length) {
    return { ...none, reasons: ["Different accounts"] };
  } else {
    score += 10;
    reasons.push("Account unknown on one side");
  }
  // Amount + direction + currency (already exact)
  score += 30;
  matched.push("amount", "currency");
  score += 10;
  matched.push(directionIgnored ? "card payment" : "direction");
  // Date
  if (dayGap === 0) {
    score += 20;
    matched.push("date");
  } else {
    score += dayGap === 1 ? 14 : 8;
    reasons.push(`Dates ${dayGap} day(s) apart`);
  }
  // Reference number — strongest signal both ways
  const ra = cleanRef(a.referenceNumber);
  const rb = cleanRef(b.referenceNumber);
  if (ra && rb) {
    if (ra === rb || (ra.length >= 6 && rb.length >= 6 && (ra.endsWith(rb) || rb.endsWith(ra)))) {
      score += 15;
      matched.push("reference");
    } else {
      score -= 30;
      reasons.push("Different reference numbers");
    }
  }
  // Merchant / description
  const ma = merchantKey(a.merchantName);
  const mb = merchantKey(b.merchantName);
  if (ma && mb && (ma === mb || ma.startsWith(`${mb} `) || mb.startsWith(`${ma} `))) {
    score += 10;
    matched.push("merchant");
  } else {
    const sim = Math.max(
      textSimilarity(a.description, b.description),
      ma ? textSimilarity(ma, b.description) : 0,
      mb ? textSimilarity(mb, a.description) : 0,
    );
    if (sim >= 0.5) {
      score += 7;
      matched.push("description");
    } else if (sim >= 0.25) {
      score += 4;
      matched.push("description (partial)");
    }
  }
  // Exact time when both sides know it
  if (a.transactionAt && b.transactionAt) {
    const mins = Math.abs(a.transactionAt.getTime() - b.transactionAt.getTime()) / 60_000;
    if (mins <= 5) {
      score += 5;
      matched.push("time");
    } else if (mins > 120 && dayGap === 0) {
      score -= 10;
      reasons.push("Times more than 2 hours apart");
    }
  }
  return { score: Math.max(0, Math.min(100, score)), matchedFields: matched, reasons };
}

export type DuplicateVerdict = "AUTO_MATCH" | "REVIEW" | "UNIQUE";

export function verdictFor(score: number): DuplicateVerdict {
  if (score >= AUTO_MATCH_THRESHOLD) return "AUTO_MATCH";
  if (score >= REVIEW_THRESHOLD) return "REVIEW";
  return "UNIQUE";
}

/** Pick the best-scoring candidate. */
export function bestMatch<T>(target: DuplicateComparable, candidates: { item: T; comparable: DuplicateComparable }[]) {
  let best: { item: T; result: DuplicateScore } | null = null;
  for (const c of candidates) {
    const result = scoreDuplicate(target, c.comparable);
    if (result.score > 0 && (!best || result.score > best.result.score)) best = { item: c.item, result };
  }
  return best;
}

