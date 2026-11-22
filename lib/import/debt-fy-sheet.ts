import { excelMoney } from "@/lib/import/debt-excel";

/**
 * Reads a financial-year debt sheet laid out like this (pure, unit-tested):
 *
 *   SL# | Lender Name | Type | Payment Due date | Month | Total outstanding | Current month payment |
 *        Paid by current month | Remaining Balance | Interest / Total EMI | Remaining EMI | Diff | Month | …
 *
 * i.e. one row per lender and one block of columns per month (April → March), plus a
 * summary underneath with "Salary of the Month" / "Additional Income of the month".
 *
 *  • "Current month payment" is what's due; "Paid by current month" is what was paid.
 *  • The interest column is ignored (FinSight360 works interest out itself).
 *  • A month that's still open (nothing paid and remaining = outstanding) keeps only the
 *    outstanding and amount due, so the app fills in the payment from your statements.
 */

export type FyRow = {
  month: string;
  lender: string;
  openingOutstanding: string | null;
  amountDue: string | null;
  payment: string | null;
  paidToDate: null;
  closingOutstanding: string | null;
  interest: null;
  remainingEmis: number | null;
};
export type FyLender = { name: string; type: string | null; dueDay: number | null; suggestedKind: "DEBT" | "COMMITMENT" };
export type FyIncome = { month: string; salary: string | null; otherIncome: string | null };
export type FySheet = { rows: FyRow[]; lenders: FyLender[]; incomes: FyIncome[]; months: string[]; fy: string; warnings: string[] };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const t = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const low = (v: unknown) => t(v).toLowerCase();

/** "FY 26-27" / "FY 2026-27" / "2026-2027" → 2026 (the April it starts in). */
export function fyStartFromName(name: string): number | null {
  const m = /(?:fy\s*)?(20)?(\d{2})\s*[-–/]\s*(20)?(\d{2})/i.exec(name);
  if (!m) return null;
  const a = 2000 + Number(m[2]);
  const b = 2000 + Number(m[4]);
  return b === a + 1 ? a : null;
}

/** "April " / "Auguest" / "Sept" → "2026-04" for FY 2026-27 (Jan–Mar fall in the next year). */
export function fyMonth(label: unknown, fyStart: number): string | null {
  const s = low(label).replace(/[^a-z]/g, "");
  if (s.length < 3) return null;
  const i = MONTHS.indexOf(s.slice(0, 3));
  if (i < 0) return null;
  const year = i >= 3 ? fyStart : fyStart + 1;
  return `${year}-${String(i + 1).padStart(2, "0")}`;
}

/** "2nd of every Month" / "05th" / "20" → 2 / 5 / 20. */
export function dueDayOf(v: unknown): number | null {
  const m = /(\d{1,2})/.exec(t(v));
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 1 && d <= 31 ? d : null;
}

const COMMITMENT_NAME = /\b(rent|chit+y|chit|kuri|sip|mutual|fund|ksfe|insurance|lic|premium|misc|miscellaneous|school|fee|maid|savings?|rd\b|recurring)/i;
const DEBT_TYPE = /(card|loan|pl\b|credit|emi|borrow)/i;

/** Is this grid laid out as a financial-year sheet (several "Month" columns next to a lender column)? */
export function isFySheet(grid: unknown[][]): boolean {
  for (const row of grid.slice(0, 10)) {
    const cells = row.map(low);
    if (cells.some((c) => /lender|name/.test(c)) && cells.filter((c) => c === "month").length >= 2) return true;
  }
  return false;
}

export function parseFySheet(grid: unknown[][], fyStart: number): FySheet {
  const warnings: string[] = [];
  const headerIdx = grid.findIndex((row) => row.map(low).filter((c) => c === "month").length >= 2);
  if (headerIdx < 0) return { rows: [], lenders: [], incomes: [], months: [], fy: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`, warnings: ["No month columns found."] };
  const header = grid[headerIdx].map(low);
  const col = (re: RegExp, from = 0, to = header.length) => {
    for (let i = from; i < to; i++) if (re.test(header[i])) return i;
    return -1;
  };
  const lenderCol = col(/lender|name/);
  const typeCol = col(/^type/);
  const dueCol = col(/due/);
  const starts = header.map((h, i) => (h === "month" ? i : -1)).filter((i) => i >= 0);
  const blocks = starts.map((s, k) => {
    const end = starts[k + 1] ?? header.length;
    return {
      start: s,
      opening: col(/total\s*outstanding/, s, end),
      due: col(/current\s*month\s*payment/, s, end),
      paid: col(/paid/, s, end),
      closing: col(/remaining\s*balance/, s, end),
      emis: col(/remaining\s*emi/, s, end),
    };
  });

  const rows: FyRow[] = [];
  const lenders = new Map<string, FyLender>();
  const incomes = new Map<string, FyIncome>();
  const monthsSeen = new Set<string>();

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const name = t(row[lenderCol]);
    if (!name) continue;
    // Summary rows under the table: salary / other income by month ("Current month" is the block's 2nd column).
    if (/salary/i.test(name) || /additional\s*income|other\s*income/i.test(name)) {
      const field = /salary/i.test(name) ? "salary" : "otherIncome";
      blocks.forEach((b, k) => {
        // The month of block k is the one its rows use; fall back to April + k.
        const month = [...monthsSeen].sort()[k] ?? fyMonth(MONTHS[(3 + k) % 12], fyStart);
        const v = excelMoney(row[b.start + 1]);
        if (!month || v === null) return;
        const inc = incomes.get(month) ?? { month, salary: null, otherIncome: null };
        inc[field] = v;
        incomes.set(month, inc);
      });
      continue;
    }
    if (/^(grand\s*)?total|outstanding$|month\s*payment$|by\s*this\s*month$|added\s*by|reduced\s*by|^sl/i.test(name) || !/[a-z]/i.test(name) || t(row[0]) === "" && !blocks.some((b) => t(row[b.start]))) continue;

    const type = typeCol >= 0 ? t(row[typeCol]) || null : null;
    const dueDay = dueCol >= 0 ? dueDayOf(row[dueCol]) : null;
    if (!lenders.has(name.toLowerCase())) {
      const isCommitment = (type ? /invest/i.test(type) : false) || (!(type && DEBT_TYPE.test(type)) && COMMITMENT_NAME.test(name));
      lenders.set(name.toLowerCase(), { name: name.slice(0, 120), type, dueDay, suggestedKind: isCommitment ? "COMMITMENT" : "DEBT" });
    }

    for (const b of blocks) {
      const month = fyMonth(row[b.start], fyStart);
      if (!month) continue;
      const opening = b.opening >= 0 ? excelMoney(row[b.opening]) : null;
      const due = b.due >= 0 ? excelMoney(row[b.due]) : null;
      const paid = b.paid >= 0 ? excelMoney(row[b.paid]) : null;
      let closing = b.closing >= 0 ? excelMoney(row[b.closing]) : null;
      const emiRaw = b.emis >= 0 ? excelMoney(row[b.emis]) : null;
      if ([opening, due, paid, closing].every((v) => v === null)) continue;
      // A lone "0" remaining balance with nothing else filled in is an empty month, not a figure.
      if (opening === null && due === null && paid === null) continue;
      // Still open: nothing paid and "remaining" just repeats the outstanding → let the app work it out.
      if (paid === null && closing !== null && opening !== null && Number(closing) === Number(opening)) closing = null;
      // A blank "remaining balance" next to a payment is outstanding − paid in the sheet's own terms.
      if (closing === null && opening !== null && paid !== null) closing = (Math.round((Number(opening) - Number(paid)) * 100) / 100).toFixed(2);
      monthsSeen.add(month);
      rows.push({
        month,
        lender: name.slice(0, 120),
        openingOutstanding: opening,
        amountDue: due,
        payment: paid,
        paidToDate: null,
        closingOutstanding: closing !== null && Number(closing) < 0 ? "0.00" : closing,
        interest: null,
        // EMIs left only make sense for loans (cards' "remaining EMI" cells hold other numbers).
        remainingEmis: !/card/i.test(type ?? "") && emiRaw !== null && Number(emiRaw) >= 0 && Number(emiRaw) <= 600 && Number.isInteger(Number(emiRaw)) ? Number(emiRaw) : null,
      });
    }
  }
  const months = [...monthsSeen].sort();
  if (!rows.length) warnings.push("No lender rows with amounts were found.");
  return {
    rows: rows.sort((a, b) => a.month.localeCompare(b.month)),
    lenders: [...lenders.values()],
    incomes: [...incomes.values()].filter((i) => months.includes(i.month)).sort((a, b) => a.month.localeCompare(b.month)),
    months,
    fy: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`,
    warnings,
  };
}
