import { parseAmount, parseDateWith, DATE_FORMATS, type DateFormat } from "@/lib/import/values";
import { extractReference } from "@/lib/import/classify";
import { Decimal, toDecimal } from "@/lib/money";

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

const DATE_AT_START = /^\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{1,2}[- ][A-Za-z]{3,4}[- ,]+\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const AMOUNT = /(?:^|\s)(\(?-?(?:₹\s?)?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\)?(?:\s?(?:Cr|Dr|CR|DR)\.?)?)(?=\s|$)/g;
const SKIP = /(opening balance|closing balance|balance b\/?f|brought forward|carried forward|statement of account|page \d+ of \d+|^\s*page\s+\d+|total|grand total)/i;

function parseAnyDate(token: string): Date | null {
  for (const f of DATE_FORMATS as readonly DateFormat[]) {
    if (f === "MM/dd/yyyy") continue; // Indian statements use dd/MM
    const d = parseDateWith(token.replace(/,/g, " ").replace(/\s+/g, " "), f);
    if (d) return d;
  }
  return null;
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

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " ");
    if (/opening balance|balance b\/?f|brought forward/i.test(line)) {
      const amts = trailingAmounts(line);
      const last = amts.length ? parseAmount(amts[amts.length - 1].text) : null;
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
      const amts = trailingAmounts(rest);
      if (!amts.length) {
        current = null;
        continue;
      }
      // Drop a value-date column printed between the narration and the amounts.
      const description = rest
        .slice(0, amts[0].index)
        .replace(/\s+\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      const parsed = amts.map((a) => parseAmount(a.text)).filter((a): a is NonNullable<typeof a> => a !== null);
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
      const bal = toDecimal(r.balance);
      if (prev !== null) {
        const amt = toDecimal(r.amount);
        if (prev.plus(amt).equals(bal)) {
          if (r.direction === null || r.direction === "CREDIT") {
            r.direction = "CREDIT";
            r.method = "BALANCE";
          }
        } else if (prev.minus(amt).equals(bal)) {
          if (r.direction === null || r.direction === "DEBIT") {
            r.direction = "DEBIT";
            r.method = "BALANCE";
          }
        }
        if (r.method === "BALANCE") verified++;
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
        r.direction = /\b(SALARY|REFUND|REVERSAL|INTEREST|CREDIT|CR|DEPOSIT|RECEIVED|NEFT CR|IMPS CR|CASHBACK)\b/i.test(r.description) ? "CREDIT" : "DEBIT";
        r.method = "GUESS";
      }
    }
    r.confidence = r.method === "BALANCE" ? 95 : r.method === "MARKER" ? 90 : r.method === "CARD_DEFAULT" ? 85 : 50;
  }
  const withBalance = rows.filter((r) => r.balance !== null).length;
  return { rows, openingBalance, verifiedShare: withBalance ? verified / withBalance : 0 };
}
