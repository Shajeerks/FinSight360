import { parseAmount, parseDateWith, DATE_FORMATS, type DateFormat } from "@/lib/import/values";
import { extractReference } from "@/lib/import/classify";
import { Decimal, toDecimal } from "@/lib/money";
import { labelsIn } from "@/lib/import/card-bill";

/**
 * Heuristic transaction extractor for text-based bank / card statement PDFs.
 * Never invents transactions: a line becomes a row only if it starts with a
 * date and ends with at least one amount. The debit/credit side is decided by
 *   1) the running balance (most reliable),
 *   2) an explicit Dr/Cr marker, or
 *   3) a guess — those rows get low confidence and go to manual review.
 */
export type PdfRow = {
  rowNumber: number;
  transactionDate: Date;
  description: string;
  amount: string; // positive
  direction: "DEBIT" | "CREDIT" | null;
  balance: string | null;
  referenceNumber: string | null;
  confidence: number;
  method: "BALANCE" | "MARKER" | "CARD_DEFAULT" | "GUESS";
  raw: string;
};

/** Dates banks print at the start of a row: 16/10/2026, 16-10-26, 16 Oct 2026, 16-OCT-26, 16Oct2026, Oct 16, 2026, 2026-10-16, 2026/10/16. */
const DATE_AT_START = /^\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[- ]?[A-Za-z]{3,4}[- ,']*\d{2,4}|[A-Za-z]{3,4}\.? \d{1,2},? \d{4}|\d{4}[-/]\d{2}[-/]\d{2})\b/;
/** Money: 1,23,456.78 / 1234.50 / ₹ 1,200.00 / Rs.500.00 / INR 500.00 / 1,200 (grouped, no paise) / (500.00) / 500.00 Cr. */
const AMOUNT = /(?:^|\s)(\(?(?:[-+]\s?)?(?:(?:₹|Rs\.?|INR)\s?)?(?:(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}|\d{1,3}(?:,\d{2,3})+)\)?(?:\s*(?:Cr|Dr|CR|DR|C|D)\.?)?)(?=\s|$)/g;
const TIME_AT_START = /^\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\b/;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** A serial-number column before the date ("1  01-10-2026 …", "12. 01 Oct 2026 …"), e.g. Kotak 811. */
const SERIAL_BEFORE_DATE = /^\s*\d{1,5}[.)]?\s+(?=\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b|\d{1,2}[- ][A-Za-z]{3,4}[- ,]+\d{2,4}\b|\d{4}-\d{2}-\d{2}\b)/;
const SKIP = /(opening balance|closing balance|balance b\/?f|brought forward|carried forward|statement of account|page \d+ of \d+|^\s*page\s+\d+|total|grand total)/i;

function parseAnyDate(token: string): Date | null {
  const t = token.trim();
  // "Oct 16, 2026", "16Oct2026", "16-OCT-'26", "2026/10/16"
  let m = /^([A-Za-z]{3,4})\.? (\d{1,2}),? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1].toLowerCase()]) return utc(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  m = /^(\d{1,2})[- ]?([A-Za-z]{3,4})[- ,']*(\d{2,4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return utc(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(t);
  if (m) return utc(+m[1], +m[2], +m[3]);
  for (const f of DATE_FORMATS as readonly DateFormat[]) {
    if (f === "MM/dd/yyyy") continue; // Indian statements use dd/MM
    const d = parseDateWith(token.replace(/,/g, " ").replace(/\s+/g, " "), f);
    if (d) return d;
  }
  return null;
}

/** parseAmount plus card-statement markers: a trailing "C"/"D" (SBI Card) and a leading "+" for credits. */
function parseMoney(text: string) {
  const t = text.trim().replace(/\s+([CD])\.?$/, (_, x: string) => (x === "C" ? " CR" : " DR"));
  const p = parseAmount(t.replace(/^\+\s*/, ""));
  if (p && !p.suffix && /^\+/.test(t)) return { ...p, suffix: "CR" as const };
  return p;
}

function utc(y: number, m: number, d: number): Date | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDate() === d ? dt : null;
}

function trailingAmounts(rest: string) {
  const found: { text: string; index: number }[] = [];
  for (const m of rest.matchAll(AMOUNT)) found.push({ text: m[1], index: (m.index ?? 0) + m[0].indexOf(m[1]) });
  // keep only the amounts at the end of the line (the table's numeric columns)
  const out: typeof found = [];
  let end = rest.trimEnd().length;
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    const after = rest.slice(f.index + f.text.length, end).trim();
    if (after !== "") break;
    out.unshift(f);
    end = f.index;
  }
  return out;
}

export function parseStatementLines(lines: string[], opts: { accountKind: "bank" | "card" | "cash" } = { accountKind: "bank" }): { rows: PdfRow[]; openingBalance: string | null; verifiedShare: number } {
  const rows: PdfRow[] = [];
  let openingBalance: string | null = null;
  let current: PdfRow | null = null;

  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li];
    let line = rawLine.replace(/ /g, " ");
    // The values row under a bill-summary header ("Statement Date  Payment Due Date  Total
    // Amount Due …" / "05/10/2026  25/10/2026  4,436.00 …") is not a transaction.
    if (opts.accountKind === "card" && li > 0 && labelsIn(lines[li - 1]).length >= 2) {
      current = null;
      continue;
    }
    // Skip a leading serial-number column so the row still starts with its date.
    const startsWithDate = DATE_AT_START.exec(line);
    if (!startsWithDate || !parseAnyDate(startsWithDate[1])) {
      const serial = SERIAL_BEFORE_DATE.exec(line);
      if (serial) line = line.slice(serial[0].length);
    }
    if (/opening balance|balance b\/?f|brought forward/i.test(line)) {
      const amts = trailingAmounts(line);
      const last = amts.length ? parseMoney(amts[amts.length - 1].text) : null;
      if (last && openingBalance === null) openingBalance = last.suffix === "DR" ? `-${last.amount.replace("-", "")}` : last.amount;
      current = null;
      continue;
    }
    const dm = DATE_AT_START.exec(line);
    const date = dm ? parseAnyDate(dm[1]) : null;
    if (date) {
      let rest = line.slice(dm![0].length);
      // Many statements print a second (value) date right after the first.
      const second = DATE_AT_START.exec(rest);
      if (second && parseAnyDate(second[1])) rest = rest.slice(second[0].length);
      rest = rest.replace(TIME_AT_START, "");
      let amts = trailingAmounts(rest);
      if (!amts.length) {
        // The amounts are on a following line (a narration that wraps, or a PDF that puts each
        // cell on its own line): join lines up to the first one that ends with amounts,
        // stopping at the next dated row.
        let joined = rest;
        let used = 0;
        for (let k = li + 1; k < Math.min(li + 5, lines.length); k++) {
          const next = lines[k].replace(/\u00a0/g, " ");
          const nd = DATE_AT_START.exec(next);
          if ((nd && parseAnyDate(nd[1])) || SKIP.test(next)) break;
          joined = `${joined}   ${next.trim()}`;
          used = k - li;
          if (trailingAmounts(joined).length) break;
        }
        amts = trailingAmounts(joined);
        if (!amts.length) {
          current = null;
          continue;
        }
        rest = joined;
        li += used;
      }
      // Drop a value-date column printed between the narration and the amounts.
      const description = rest
        .slice(0, amts[0].index)
        .replace(/\s+\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      const parsed = amts.map((a) => parseMoney(a.text)).filter((a): a is NonNullable<typeof a> => a !== null);
      if (!parsed.length) continue;
      let txn = parsed[0];
      let balance: string | null = null;
      if (parsed.length >= 2) {
        balance = parsed[parsed.length - 1].suffix === "DR" ? `-${parsed[parsed.length - 1].amount.replace("-", "")}` : parsed[parsed.length - 1].amount;
        // With three numbers (withdrawal, deposit, balance) take the non-zero one.
        const candidates = parsed.slice(0, -1).filter((p) => !/^-?0+\.00$/.test(p.amount));
        txn = candidates[0] ?? parsed[0];
      }
      const amount = txn.amount.replace("-", "");
      if (/^0+\.00$/.test(amount)) continue;
      let direction: PdfRow["direction"] = null;
      let method: PdfRow["method"] = "GUESS";
      if (txn.suffix) {
        direction = txn.suffix === "CR" ? "CREDIT" : "DEBIT";
        method = "MARKER";
      } else if (txn.amount.startsWith("-")) {
        direction = "DEBIT";
        method = "MARKER";
      }
      current = {
        rowNumber: rows.length + 1,
        transactionDate: date,
        description: description || "(no description)",
        amount,
        direction,
        balance,
        referenceNumber: extractReference(description),
        confidence: 0,
        method,
        raw: line.trim(),
      };
      if (SKIP.test(description) && !description.match(/[a-z]{4,}.*[a-z]{4,}/i)) {
        current = null;
        continue;
      }
      rows.push(current);
    } else if (current && line.trim() && !SKIP.test(line) && !trailingAmounts(line).length && line.trim().length < 120) {
      // Wrapped description line.
      current.description = `${current.description} ${line.trim()}`.replace(/\s{2,}/g, " ");
      current.referenceNumber ??= extractReference(line);
      current.raw += ` | ${line.trim()}`;
    } else {
      current = null;
    }
  }

  // Running-balance verification.
  let prev: Decimal | null = openingBalance !== null ? toDecimal(openingBalance) : null;
  let verified = 0;
  for (const r of rows) {
    if (r.balance !== null) {
      let bal = toDecimal(r.balance);
      if (prev !== null) {
        const amt = toDecimal(r.amount);
        const verify = (dir: "CREDIT" | "DEBIT") => {
          if (r.direction === null || r.direction === dir) {
            r.direction = dir;
            r.method = "BALANCE";
          }
        };
        if (prev.plus(amt).equals(bal)) verify("CREDIT");
        else if (prev.minus(amt).equals(bal)) verify("DEBIT");
        // Overdrawn balances printed without a minus sign (e.g. Kotak during a sweep):
        // the running total only works if this balance is negative.
        else if (!bal.isNegative() && !bal.isZero() && prev.minus(amt).equals(bal.negated())) {
          verify("DEBIT");
          bal = bal.negated();
        } else if (!bal.isNegative() && !bal.isZero() && prev.plus(amt).equals(bal.negated())) {
          verify("CREDIT");
          bal = bal.negated();
        }
        if (r.method === "BALANCE") {
          verified++;
          r.balance = bal.toFixed(2);
        }
      }
      prev = bal;
    } else {
      prev = null;
    }
  }
  for (const r of rows) {
    if (!r.direction) {
      if (opts.accountKind === "card") {
        r.direction = "DEBIT";
        r.method = "CARD_DEFAULT";
      } else {
        r.direction = /\b(SALARY|REFUND|REVERSAL|INTEREST|CREDIT(?!\s*CARD)|CR|DEPOSIT|RECEIVED|NEFT CR|IMPS CR|CASHBACK|SWEEP\s+TRF\s+FROM|SWEEP\s+TRANSFER\s+FROM)\b/i.test(r.description) ? "CREDIT" : "DEBIT";
        r.method = "GUESS";
      }
    }
    r.confidence = r.method === "BALANCE" ? 95 : r.method === "MARKER" ? 90 : r.method === "CARD_DEFAULT" ? 85 : 50;
  }
  const withBalance = rows.filter((r) => r.balance !== null).length;
  return { rows, openingBalance, verifiedShare: withBalance ? verified / withBalance : 0 };
}
