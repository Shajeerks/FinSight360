/**
 * Parsing helpers for bank statement cells (pure, unit-tested).
 * Amounts are returned as exact decimal STRINGS ("1250.50") — never floats.
 */

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };

export const DATE_FORMATS = ["dd/MM/yyyy", "dd-MM-yyyy", "dd.MM.yyyy", "dd/MM/yy", "dd-MM-yy", "dd-MMM-yyyy", "dd MMM yyyy", "dd-MMM-yy", "dd MMM yy", "yyyy-MM-dd", "MM/dd/yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

function mk(y: number, m: number, d: number): Date | null {
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

/** Parse a date cell in a specific format. Returns a UTC-midnight Date or null. */
export function parseDateWith(value: string, format: DateFormat): Date | null {
  const v = value.trim().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  switch (format) {
    case "yyyy-MM-dd":
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
      return m ? mk(+m[1], +m[2], +m[3]) : null;
    case "MM/dd/yyyy":
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      return m ? mk(+m[3], +m[1], +m[2]) : null;
    case "dd/MM/yyyy":
    case "dd-MM-yyyy":
    case "dd.MM.yyyy": {
      const sep = format[2] === "." ? "\\." : format[2];
      m = new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{4})$`).exec(v);
      return m ? mk(+m[3], +m[2], +m[1]) : null;
    }
    case "dd/MM/yy":
    case "dd-MM-yy": {
      m = new RegExp(`^(\\d{1,2})${format[2]}(\\d{1,2})${format[2]}(\\d{2})$`).exec(v);
      return m ? mk(+m[3], +m[2], +m[1]) : null;
    }
    case "dd-MMM-yyyy":
    case "dd MMM yyyy":
    case "dd-MMM-yy":
    case "dd MMM yy": {
      m = /^(\d{1,2})[- ]([A-Za-z]{3,4})[- ,]+(\d{2}|\d{4})$/.exec(v);
      if (!m) return null;
      const mon = MONTHS[m[2].toUpperCase()];
      const longYear = format.endsWith("yyyy");
      if (!mon || (longYear ? m[3].length !== 4 : m[3].length !== 2)) return null;
      return mk(+m[3], mon, +m[1]);
    }
  }
}

/** Pick the format that parses (nearly) all samples; prefers Indian dd/MM over MM/dd. */
export function detectDateFormat(samples: string[]): DateFormat | null {
  const vals = samples.map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (!vals.length) return null;
  let best: { f: DateFormat; ok: number } | null = null;
  for (const f of DATE_FORMATS) {
    const ok = vals.filter((v) => parseDateWith(v, f)).length;
    if (!best || ok > best.ok) best = { f, ok };
  }
  return best && best.ok / vals.length >= 0.8 ? best.f : null;
}

/**
 * "1,25,000.50" → "125000.50"; "(1,250.00)" → "-1250.00"; "1250 Dr" → "-1250.00";
 * "₹ 1,250" → "1250.00"; "" / "-" → null. Credit/debit suffix is returned separately.
 */
export function parseAmount(value: string | number | null | undefined): { amount: string; suffix: "DR" | "CR" | null } | null {
  if (value === null || value === undefined) return null;
  let v = String(value).trim();
  if (!v || /^[-–—]$/.test(v)) return null;
  let suffix: "DR" | "CR" | null = null;
  const sm = /\s*(?<![A-Za-z])(DR|CR|Dr|Cr|dr|cr)\.?$/.exec(v);
  if (sm) {
    suffix = sm[1].toUpperCase() as "DR" | "CR";
    v = v.slice(0, sm.index).trim();
  }
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/(INR|Rs\.?|₹)/gi, "").replace(/[\s,]/g, "");
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith("+")) v = v.slice(1);
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const [int, frac = ""] = v.split(".");
  if (frac.length > 2 && !/^0+$/.test(frac.slice(2))) return null; // more precision than paise → not money
  const normalized = `${int.replace(/^0+(?=\d)/, "")}.${(frac + "00").slice(0, 2)}`;
  return { amount: negative ? `-${normalized}` : normalized, suffix };
}

export function isZeroAmount(a: string) {
  return /^-?0+\.00$/.test(a);
}

// ───────────────────────── header detection & mapping ─────────────────────────

export type MappingField = "transactionDate" | "description" | "debit" | "credit" | "amount" | "type" | "referenceNumber" | "balance";

const SYNONYMS: Record<MappingField, string[]> = {
  transactionDate: ["date", "txn date", "transaction date", "tran date", "trans date", "posting date", "post date", "value date", "value dt", "txn dt"],
  description: ["narration", "description", "particulars", "transaction details", "details", "remarks", "transaction remarks", "transaction description", "merchant", "merchant name"],
  debit: ["debit", "withdrawal", "withdrawals", "withdrawal amt", "withdrawal amount", "withdrawal amt.", "dr", "debit amount", "debit amt", "amount (dr)", "dr amount"],
  credit: ["credit", "deposit", "deposits", "deposit amt", "deposit amount", "deposit amt.", "cr", "credit amount", "credit amt", "amount (cr)", "cr amount"],
  amount: ["amount", "transaction amount", "amt", "amount (inr)", "inr amount", "amount(inr)", "billing amount"],
  type: ["type", "dr/cr", "cr/dr", "debit/credit", "transaction type", "txn type", "dr / cr"],
  referenceNumber: ["ref", "reference", "ref no", "ref no.", "chq./ref.no.", "chq/ref no", "cheque no", "cheque no.", "chq no", "utr", "utr no", "reference number", "ref no./cheque no.", "transaction id", "txn id"],
  balance: ["balance", "closing balance", "running balance", "available balance", "balance (inr)", "bal"],
};

function norm(h: string) {
  return h.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9/(). ]/g, "").trim();
}

function fieldFor(header: string): MappingField | null {
  const h = norm(header);
  if (!h) return null;
  for (const [field, list] of Object.entries(SYNONYMS) as [MappingField, string[]][]) {
    if (list.includes(h)) return field;
  }
  // Partial matches (e.g. "Withdrawal Amount (INR)")
  if (/withdraw|debit/.test(h)) return "debit";
  if (/deposit|credit/.test(h)) return "credit";
  if (/narration|particular|description|remark/.test(h)) return "description";
  if (/balance/.test(h)) return "balance";
  if (/ref|chq|cheque|utr/.test(h)) return "referenceNumber";
  if (/date/.test(h)) return "transactionDate";
  if (/amount/.test(h)) return "amount";
  return null;
}

/** Index of the row that looks like the header (date + description present), within the first 40 rows. */
export function findHeaderRow(rows: string[][]): number {
  let best = { index: 0, score: 0 };
  rows.slice(0, 40).forEach((row, index) => {
    const fields = new Set(row.map(fieldFor).filter(Boolean));
    let score = fields.size;
    if (fields.has("transactionDate")) score += 2;
    if (fields.has("description")) score += 2;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 5 ? best.index : 0;
}

export type ColumnMapping = Partial<Record<MappingField, number>>;

/** Suggest column indexes for each field from the header row. First match wins (e.g. Txn Date before Value Date). */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((h, i) => {
    const f = fieldFor(h);
    if (!f || mapping[f] !== undefined) return;
    if (f === "transactionDate" && /value/.test(norm(h)) && headers.some((x, j) => j !== i && fieldFor(x) === "transactionDate" && !/value/.test(norm(x)))) return;
    mapping[f] = i;
  });
  return mapping;
}

/** Best amount mode for a mapping. */
export function suggestAmountMode(m: ColumnMapping): "DEBIT_CREDIT_COLUMNS" | "SIGNED_AMOUNT" | "AMOUNT_WITH_TYPE_COLUMN" {
  if (m.debit !== undefined && m.credit !== undefined) return "DEBIT_CREDIT_COLUMNS";
  if (m.amount !== undefined && m.type !== undefined) return "AMOUNT_WITH_TYPE_COLUMN";
  return "SIGNED_AMOUNT";
}

/** Normalized header signature — lets us re-apply a saved template to the same bank's exports. */
export function headerSignature(headers: string[]): string {
  return headers.map(norm).filter(Boolean).join("|");
}
