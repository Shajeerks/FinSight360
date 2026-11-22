import { Decimal, toDecimal, type MoneyInput } from "@/lib/money";

/**
 * Does a bank debit look like a payment of this loan? (pure, unit-tested)
 *
 * Bank statements rarely say "EMI for loan X". What they do show:
 *   NACH00000000022163 BD- IndusindBan        ← lender name squashed into a code
 *   ICIC00261000001992 TP EMANDATE            ← mandate debit, no name
 *   IMPS/…/xx103-Muhammed/Loan Rep            ← "loan repayment"
 * So the lender's name is looked for inside the text with spaces/punctuation removed,
 * and the amount, mandate markers and the instalment due date add confidence.
 */

const STOP = new Set(["BANK", "LTD", "LIMITED", "FINANCE", "FINANCIAL", "SERVICES", "SERVICE", "THE", "INDIA", "PVT", "PRIVATE", "COMPANY", "LOAN", "LOANS", "CREDIT", "CARD", "HOUSING", "CAPITAL", "NBFC", "AND", "FIN", "CORP", "CORPORATION", "PERSONAL", "HOME"]);
const MARKER = /\b(NACH|ACH|ECS|EMI|LOAN|E-?MANDATE|MANDATE|AUTOPAY|AUTO\s?DEBIT|SI)\b|EMANDATE|LOANREP|ACHDR|NACHDR/;

export type LoanForMatch = { id: string; lender: string; name: string; accountLast4: string | null; emiAmount: MoneyInput; dueDates: Date[] };
export type DebitForMatch = { amount: MoneyInput; description: string; merchantName: string | null; transactionType: string; transactionDate: Date };
export type LoanMatch = { loanId: string; score: number; amountExact: boolean; reasons: string[] };

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Distinctive words of the lender / loan name ("IndusInd Bank" → ["INDUSIND"], "Kredit Bee" → ["KREDITBEE", "KREDIT"]). */
export function lenderTokens(lender: string, name = ""): string[] {
  const out = new Set<string>();
  for (const text of [lender, name]) {
    const words = text.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
    words.forEach((w) => out.add(w));
    const whole = compact(text.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => !STOP.has(w)).join(""));
    if (whole.length >= 5) out.add(whole);
  }
  return [...out];
}

export function scoreLoanPayment(t: DebitForMatch, loan: LoanForMatch): LoanMatch {
  const text = `${t.description} ${t.merchantName ?? ""}`;
  const upper = text.toUpperCase();
  const squashed = compact(text);
  const reasons: string[] = [];
  let score = 0;

  const emi = toDecimal(loan.emiAmount);
  const diff = toDecimal(t.amount).minus(emi).abs();
  const amountExact = diff.lessThanOrEqualTo(1);
  if (amountExact) {
    score += 50;
    reasons.push("same amount as the EMI");
  } else if (emi.greaterThan(0) && diff.dividedBy(emi).lessThanOrEqualTo(new Decimal("0.02"))) {
    score += 30;
    reasons.push("close to the EMI");
  }
  if (lenderTokens(loan.lender, loan.name).some((w) => squashed.includes(w))) {
    score += 35;
    reasons.push(`mentions ${loan.lender}`);
  }
  if (loan.accountLast4 && new RegExp(`(^|\\D)${loan.accountLast4}(\\D|$)`).test(text)) {
    score += 30;
    reasons.push(`loan no. ••${loan.accountLast4}`);
  }
  if (t.transactionType === "EMI" || MARKER.test(upper)) {
    score += 15;
    reasons.push("auto-debit / EMI");
  }
  const day = 86_400_000;
  if (loan.dueDates.some((d) => Math.abs(d.getTime() - t.transactionDate.getTime()) <= 5 * day)) {
    score += 10;
    reasons.push("near the due date");
  }
  return { loanId: loan.id, score, amountExact, reasons };
}

/** Score at or above which a payment is suggested for a loan. */
export const SUGGEST_SCORE = 50;
/** Linked automatically: exact EMI amount plus the lender's name / loan number / auto-debit near the due date, and no close second loan. */
export const AUTO_SCORE = 85;

export function bestLoanMatch(t: DebitForMatch, loans: LoanForMatch[]): (LoanMatch & { confident: boolean }) | null {
  const scored = loans.map((l) => scoreLoanPayment(t, l)).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < SUGGEST_SCORE) return null;
  const second = scored[1]?.score ?? 0;
  return { ...best, confident: best.amountExact && best.score >= AUTO_SCORE && best.score - second >= 20 };
}
