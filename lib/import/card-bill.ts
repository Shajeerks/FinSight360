/**
 * Reads the bill summary printed at the top of a credit-card statement PDF:
 * statement date, payment due date, total amount due, minimum amount due and,
 * where printed, previous balance / purchases / payments / finance charges.
 *
 * Indian card statements print these in one of three ways, all handled here:
 *   "Payment Due Date : 25/11/2026"                       (label and value on one line)
 *   "Payment Due Date" ⏎ "25 Nov 2026"                     (value on the next line)
 *   "Payment Due Date  Total Dues  Minimum Amount Due" ⏎
 *   "25/11/2026        12,345.00   620.00"                 (a header row, values below)
 * Only figures found next to a known label are used — nothing is guessed.
 */

export type CardBill = {
  statementDate: Date | null;
  dueDate: Date | null;
  totalDue: string | null;
  minimumDue: string | null;
  previousBalance: string | null;
  purchases: string | null;
  paymentsCredits: string | null;
  financeCharges: string | null;
};

type Field = keyof CardBill;
type Kind = "date" | "amount";

const LABELS: { field: Field; kind: Kind; re: RegExp }[] = [
  { field: "dueDate", kind: "date", re: /payment\s+due\s+date|due\s+date|pay(?:ment)?\s+(?:due\s+)?by/i },
  { field: "statementDate", kind: "date", re: /statement\s+(?:generation\s+)?date|bill(?:ing)?\s+date|date\s+of\s+statement/i },
  { field: "minimumDue", kind: "amount", re: /min(?:imum|\.)?\s*(?:amount|amt\.?|payment)?\s*(?:due|payable)/i },
  { field: "totalDue", kind: "amount", re: /total\s+(?:amount\s+)?(?:due|dues|payable|outstanding)|total\s+payment\s+due|closing\s+balance|new\s+balance|current\s+outstanding/i },
  { field: "previousBalance", kind: "amount", re: /previous\s+(?:statement\s+)?(?:balance|dues|outstanding)|opening\s+balance|last\s+statement\s+balance/i },
  { field: "paymentsCredits", kind: "amount", re: /payments?\s*(?:\/|&|and)?\s*(?:other\s+)?credits?(?:\s+received)?|total\s+credits/i },
  { field: "purchases", kind: "amount", re: /purchases?(?:\s*(?:\/|&|and)\s*(?:other\s+)?(?:debits?|charges))?|total\s+debits/i },
  { field: "financeCharges", kind: "amount", re: /finance\s+charges?|interest\s+charges?/i },
];

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DATE_RE = new RegExp(
  [
    String.raw`\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b`,
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-]+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?[\s\-,']+(\d{2,4})\b`,
    String.raw`\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
  ].join("|"),
  "gi",
);
// An amount: ₹/Rs/INR prefix or thousands separators or decimals, optional Cr/Dr.
const AMOUNT_RE = /(?:₹|rs\.?|inr)?\s*(-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)\s*(cr|dr)?\b/gi;

function year(y: string) {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function toDate(y: number, m: number, d: number): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCMonth() === m ? dt : null;
}

export function datesIn(text: string): { date: Date; index: number; end: number }[] {
  const out: { date: Date; index: number; end: number }[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    let d: Date | null = null;
    if (m[1]) d = toDate(year(m[3]), Number(m[2]) - 1, Number(m[1])); // dd/mm/yyyy (Indian)
    else if (m[4]) d = toDate(year(m[6]), MONTHS[m[5].toLowerCase().slice(0, 4) === "sept" ? "sept" : m[5].toLowerCase().slice(0, 3)], Number(m[4]));
    else if (m[7]) d = toDate(year(m[9]), MONTHS[m[7].toLowerCase().slice(0, 3)], Number(m[8]));
    if (d) out.push({ date: d, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

export function amountsIn(text: string): { value: string; index: number }[] {
  // Blank out dates first so "25/11/2026" isn't read as amounts.
  let masked = text;
  for (const d of datesIn(text)) masked = masked.slice(0, d.index) + " ".repeat(d.end - d.index) + masked.slice(d.end);
  const out: { value: string; index: number }[] = [];
  for (const m of masked.matchAll(AMOUNT_RE)) {
    const raw = m[1];
    const hasMarker = /₹|rs|inr/i.test(m[0]) || raw.includes(",") || raw.includes(".");
    if (!hasMarker) continue; // a bare "2026" or "4" is not a money figure
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    const signed = m[2]?.toLowerCase() === "cr" ? -Math.abs(n) : n;
    out.push({ value: signed.toFixed(2), index: (m.index ?? 0) + m[0].search(/\S/) });
  }
  return out;
}

export function labelsIn(line: string) {
  const found: { field: Field; kind: Kind; index: number; end: number }[] = [];
  for (const l of LABELS) {
    const re = new RegExp(l.re.source, "gi");
    for (const m of line.matchAll(re)) {
      const index = m.index ?? 0;
      // A longer label already covers this text (e.g. "due date" inside "payment due date").
      if (found.some((f) => index < f.end && index + m[0].length > f.index)) continue;
      found.push({ field: l.field, kind: l.kind, index, end: index + m[0].length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

export function extractCardBill(lines: string[], maxLines = 120): CardBill {
  const bill: CardBill = { statementDate: null, dueDate: null, totalDue: null, minimumDue: null, previousBalance: null, purchases: null, paymentsCredits: null, financeCharges: null };
  const head = lines.slice(0, maxLines).map((l) => l.replace(/ /g, " ").replace(/\s+/g, " ").trim());
  const set = (f: Field, v: Date | string) => {
    if (bill[f] === null) (bill as Record<Field, Date | string | null>)[f] = v;
  };

  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    const labels = labelsIn(line);
    if (!labels.length) continue;

    // 1) Value right after each label on the same line (up to the next label).
    const pending: typeof labels = [];
    labels.forEach((l, k) => {
      const segment = line.slice(l.end, labels[k + 1]?.index ?? line.length);
      if (l.kind === "date") {
        const d = datesIn(segment)[0];
        if (d) return void set(l.field, d.date);
      } else {
        const a = amountsIn(segment)[0];
        if (a) return void set(l.field, a.value);
      }
      pending.push(l);
    });
    if (!pending.length) continue;

    // 2) Header row: values on the next line(s) in the same order.
    for (let j = i + 1; j < Math.min(i + 4, head.length) && pending.length; j++) {
      const next = head[j];
      if (!next || labelsIn(next).length) {
        if (next && labelsIn(next).length) break;
        continue;
      }
      const tokens = [
        ...datesIn(next).map((d) => ({ kind: "date" as const, index: d.index, date: d.date, value: "" })),
        ...amountsIn(next).map((a) => ({ kind: "amount" as const, index: a.index, date: null as Date | null, value: a.value })),
      ].sort((a, b) => a.index - b.index);
      if (!tokens.length) continue;
      let t = 0;
      for (const l of [...pending]) {
        while (t < tokens.length && tokens[t].kind !== l.kind) t++;
        if (t >= tokens.length) break;
        set(l.field, l.kind === "date" ? tokens[t].date! : tokens[t].value);
        pending.splice(pending.indexOf(l), 1);
        t++;
      }
      break;
    }
  }

  // Sanity checks: drop figures that can't be right rather than store them.
  if (bill.totalDue !== null && bill.minimumDue !== null && Number(bill.minimumDue) > Number(bill.totalDue) && Number(bill.totalDue) > 0) bill.minimumDue = null;
  if (bill.minimumDue !== null && Number(bill.minimumDue) < 0) bill.minimumDue = null;
  if (bill.statementDate && bill.dueDate) {
    const days = (bill.dueDate.getTime() - bill.statementDate.getTime()) / 86400000;
    if (days < 0 || days > 60) bill.dueDate = null;
  }
  return bill;
}

export function hasBill(b: CardBill): boolean {
  return b.totalDue !== null || b.dueDate !== null;
}
