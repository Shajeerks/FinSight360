import Papa from "papaparse";
import ExcelJS from "exceljs";

export type FileKind = "CSV" | "XLSX" | "PDF";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Identify the file by its content (magic bytes), not just its name. */
export function detectFileKind(buf: Buffer, fileName: string): FileKind | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "PDF";
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK" — xlsx is a zip
  if (isZip && /\.xlsx$/i.test(fileName)) return "XLSX";
  if (isZip) return "XLSX";
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return null; // legacy .xls (OLE) — not supported
  // Text file? Reject binary content.
  const sample = buf.subarray(0, 4096);
  let control = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) control++;
  if (control === 0 && /\.(csv|txt|tsv)$/i.test(fileName)) return "CSV";
  if (control === 0 && sample.toString("utf8").split(/\r?\n/).filter((l) => /[,;\t|]/.test(l)).length >= 2) return "CSV";
  return null;
}

/** CSV/TSV → rows of trimmed strings (delimiter auto-detected). */
export function parseCsv(buf: Buffer): string[][] {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimiter: "" });
  return (res.data as string[][]).map((r) => r.map((c) => (c ?? "").toString().trim())).filter((r) => r.some((c) => c !== ""));
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // toPrecision(15) strips binary floating-point noise (0.30000000000000004 → 0.3).
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(15)));
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v);
}

/** First worksheet with data → rows of strings. Dates become YYYY-MM-DD. */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 1) ?? wb.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) values.push(cellText(row.getCell(c).value).trim());
    if (values.some((v) => v !== "")) rows.push(values);
  });
  return rows;
}

export class PdfPasswordError extends Error {
  constructor(public readonly incorrect: boolean) {
    super(incorrect ? "Incorrect PDF password" : "PDF is password protected");
  }
}

/**
 * Text-layer extraction from a PDF, rebuilt into visual lines (items sharing a
 * baseline, left-to-right). Returns no lines for scanned/image-only PDFs.
 */
export async function extractPdfLines(buf: Buffer, password?: string): Promise<{ lines: string[]; pages: number }> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf), { password: password || undefined });
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    const code = (e as { code?: number }).code;
    if (name === "PasswordException") throw new PdfPasswordError(code === 2);
    throw e;
  }
  const lines: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    type Item = { str: string; transform: number[]; width: number };
    const items = (content.items as Item[]).filter((i) => typeof i.str === "string" && i.str.trim() !== "");
    const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = [];
    for (const it of items) {
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, w: it.width, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "";
      let lastEnd = -Infinity;
      for (const part of r.parts) {
        const gap = part.x - lastEnd;
        line += line && gap > 1 ? (gap > 12 ? "   " : " ") : "";
        line += part.s;
        lastEnd = part.x + part.w;
      }
      lines.push(line.replace(/\s+$/, ""));
    }
  }
  return { lines, pages: pdf.numPages };
}
