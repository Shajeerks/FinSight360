import ExcelJS from "exceljs";
import type { DebtExcelRow } from "@/validators/debt-tracker";

/**
 * Reads a "monthly debt sheet" workbook: usually one sheet per month with columns like
 *   Month | SI# | Lender name | Total outstanding | Current month payment | Paid by this month |
 *   Remaining balance | Interest charged by current month | Remaining EMI count | Difference from last month
 * Column names are matched loosely; the month comes from the Month column or the sheet name.
 * Total rows and blank rows are skipped. Nothing is saved here.
 */

type Field = "month" | "lender" | "opening" | "payment" | "paidToDate" | "closing" | "interest" | "remainingEmis";

const HEADERS: { field: Field; test: (h: string) => boolean }[] = [
  { field: "remainingEmis", test: (h) => /emi/.test(h) && /(remain|count|left|balance|pending|no\.? of)/.test(h) },
  { field: "interest", test: (h) => /interest|finance charge/.test(h) },
  { field: "paidToDate", test: (h) => /paid/.test(h) && /(by|till|to|upto|up to)\s*(this|the|date|now)|cumulative|total paid/.test(h) },
  { field: "payment", test: (h) => /(current|this)\s*month\s*(payment|paid|emi)|^payment|amount paid|emi paid|paid this month/.test(h) },
  { field: "closing", test: (h) => /remaining\s*(balance|outstanding|amount)|closing|balance\s*(after|now)|^balance$/.test(h) },
  { field: "opening", test: (h) => /total\s*outstanding|opening|^outstanding|outstanding\s*(amount|as on)/.test(h) },
  { field: "lender", test: (h) => /lender|bank\s*name|^name$|card\s*name|loan\s*name|creditor|^bank$|^particulars/.test(h) },
  { field: "month", test: (h) => /^month|period/.test(h) },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return (v as { result: unknown }).result;
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as { text: unknown }).text;
  }
  return v;
}

function text(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();
}

/** Excel numbers / "1,23,456.50" / "(2,000)" / "-" → "123456.50" or null. */
export function excelMoney(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return (Math.round(v * 100) / 100).toFixed(2);
  const s = text(v).replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!s || s === "-" || s === "--") return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return ((neg ? -1 : 1) * Math.round(n * 100) / 100).toFixed(2);
}

/** Date cell / "Oct 2026" / "October-26" / "10/2026" / "2026-10" → "2026-10". */
export function excelMonth(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 7);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 7);
  }
  const s = text(v).toLowerCase();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s\-'’,/]*(\d{4}|\d{2})\b/.exec(s);
  if (m) {
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return `${year}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  }
  return null;
}

export type DebtExcelPreview = {
  rows: DebtExcelRow[];
  sheets: { name: string; month: string | null; rows: number; skipped?: string }[];
  lenders: string[];
  warnings: string[];
};

export async function readDebtWorkbook(buffer: Buffer): Promise<DebtExcelPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const rows: DebtExcelRow[] = [];
  const sheets: DebtExcelPreview["sheets"] = [];
  const warnings: string[] = [];

  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== "visible") return;
    // Header row: the first row (of the first 15) that names a lender column and at least two amounts.
    let headerRow = 0;
    let cols: Partial<Record<Field, number>> = {};
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      const found: Partial<Record<Field, number>> = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const h = text(cellValue(cell.value)).toLowerCase();
        if (!h) return;
        const hit = HEADERS.find((x) => found[x.field] === undefined && x.test(h));
        if (hit) found[hit.field] = col;
      });
      const amounts = (["opening", "payment", "closing", "interest", "paidToDate"] as Field[]).filter((f) => found[f] !== undefined).length;
      if (found.lender !== undefined && amounts >= 2) {
        headerRow = r;
        cols = found;
        break;
      }
    }
    if (!headerRow) {
      sheets.push({ name: ws.name, month: null, rows: 0, skipped: "No lender / amount columns found" });
      return;
    }
    const sheetMonth = excelMonth(ws.name);
    let count = 0;
    let rowMonthMissing = false;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (f: Field) => (cols[f] === undefined ? null : cellValue(row.getCell(cols[f]!).value));
      const lender = text(get("lender"));
      if (!lender || /^(grand\s*)?total|^sum$|^net$/i.test(lender)) continue;
      const month = excelMonth(get("month")) ?? sheetMonth;
      if (!month) {
        rowMonthMissing = true;
        continue;
      }
      const emis = get("remainingEmis");
      const emiNum = excelMoney(emis);
      const out: DebtExcelRow = {
        month,
        lender: lender.slice(0, 120),
        openingOutstanding: excelMoney(get("opening")),
        payment: excelMoney(get("payment")),
        paidToDate: excelMoney(get("paidToDate")),
        closingOutstanding: excelMoney(get("closing")),
        interest: excelMoney(get("interest")),
        remainingEmis: emiNum !== null && Number(emiNum) >= 0 && Number(emiNum) <= 600 ? Math.round(Number(emiNum)) : null,
      };
      if ([out.openingOutstanding, out.payment, out.paidToDate, out.closingOutstanding, out.interest].every((v) => v === null)) continue;
      rows.push(out);
      count++;
    }
    if (rowMonthMissing) warnings.push(`Sheet "${ws.name}": some rows have no month (add a Month column or name the sheet like "Oct 2026").`);
    sheets.push({ name: ws.name, month: sheetMonth, rows: count });
  });

  // The same lender twice in one month (e.g. a sheet copied): keep the last one.
  const seen = new Map<string, number>();
  rows.forEach((r, i) => seen.set(`${r.month}|${r.lender.toLowerCase()}`, i));
  const unique = rows.filter((r, i) => seen.get(`${r.month}|${r.lender.toLowerCase()}`) === i);
  if (unique.length < rows.length) warnings.push(`${rows.length - unique.length} repeated lender row(s) in the same month were ignored (the last one is kept).`);
  const lenders = [...new Map(unique.map((r) => [r.lender.toLowerCase(), r.lender])).values()].sort((a, b) => a.localeCompare(b));
  return { rows: unique.sort((a, b) => a.month.localeCompare(b.month)), sheets, lenders, warnings };
}
