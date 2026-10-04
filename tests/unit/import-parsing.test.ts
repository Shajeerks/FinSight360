import { describe, expect, it } from "vitest";
import { detectDateFormat, findHeaderRow, headerSignature, parseAmount, parseDateWith, suggestAmountMode, suggestMapping } from "@/lib/import/values";
import { classifyImported, detectInstitution, extractReference, paymentMethodFrom } from "@/lib/import/classify";
import { parseStatementLines } from "@/lib/import/pdf-statement";
import { detectFileKind, parseCsv, parseXlsx } from "@/lib/import/files";
import ExcelJS from "exceljs";

const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("statement value parsing", () => {
  it("parses Indian amount formats exactly", () => {
    expect(parseAmount("1,25,000.50")).toEqual({ amount: "125000.50", suffix: null });
    expect(parseAmount("₹ 1,250")).toEqual({ amount: "1250.00", suffix: null });
    expect(parseAmount("(1,250.00)")).toEqual({ amount: "-1250.00", suffix: null });
    expect(parseAmount("-649.5")).toEqual({ amount: "-649.50", suffix: null });
    expect(parseAmount("24,500.00 Cr")).toEqual({ amount: "24500.00", suffix: "CR" });
    expect(parseAmount("1250.00Dr")).toEqual({ amount: "1250.00", suffix: "DR" });
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("1.234")).toBeNull();
  });

  it("parses and detects date formats (dd/MM preferred)", () => {
    expect(iso(parseDateWith("05/10/2026", "dd/MM/yyyy"))).toBe("2026-10-05");
    expect(iso(parseDateWith("05-Oct-2026", "dd-MMM-yyyy"))).toBe("2026-10-05");
    expect(iso(parseDateWith("5 Sept 26", "dd MMM yy"))).toBe("2026-09-05");
    expect(iso(parseDateWith("2026-10-05", "yyyy-MM-dd"))).toBe("2026-10-05");
    expect(parseDateWith("31/02/2026", "dd/MM/yyyy")).toBeNull();
    expect(detectDateFormat(["01/10/2026", "05/10/2026", "13/10/2026"])).toBe("dd/MM/yyyy");
    expect(detectDateFormat(["01-Oct-26", "15-Oct-26"])).toBe("dd-MMM-yy");
    expect(detectDateFormat(["hello", "world"])).toBeNull();
  });

  it("finds the header row below bank metadata and suggests the mapping", () => {
    const rows = [
      ["HDFC BANK Ltd.", "", "", "", "", "", ""],
      ["Account No : XXXX4821", "", "", "", "", "", ""],
      ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
      ["01/10/26", "SALARY", "", "01/10/26", "", "85,000.00", "1,20,000.00"],
    ];
    const h = findHeaderRow(rows);
    expect(h).toBe(2);
    const m = suggestMapping(rows[h]);
    expect(m).toEqual({ transactionDate: 0, description: 1, referenceNumber: 2, debit: 4, credit: 5, balance: 6 });
    expect(suggestAmountMode(m)).toBe("DEBIT_CREDIT_COLUMNS");
    expect(suggestAmountMode(suggestMapping(["Txn Date", "Description", "Amount", "Dr/Cr"]))).toBe("AMOUNT_WITH_TYPE_COLUMN");
    expect(headerSignature(["Date ", "NARRATION"])).toBe("date|narration");
  });
});

describe("classification", () => {
  it("infers ledger types from statement text", () => {
    expect(classifyImported("CREDIT", "bank", "NEFT CR-ACME TECH SALARY")).toBe("INCOME");
    expect(classifyImported("CREDIT", "bank", "AMAZON REFUND")).toBe("REFUND");
    expect(classifyImported("CREDIT", "bank", "SB INT PAID")).toBe("INTEREST");
    expect(classifyImported("DEBIT", "bank", "ATM CASH WDL")).toBe("ATM_WITHDRAWAL");
    expect(classifyImported("DEBIT", "bank", "HDFC CREDIT CARD PAYMENT XXXX1043")).toBe("CARD_PAYMENT");
    expect(classifyImported("DEBIT", "bank", "ACH D- GROWW SIP")).toBe("INVESTMENT");
    expect(classifyImported("DEBIT", "bank", "UPI/SWIGGY")).toBe("EXPENSE");
    expect(classifyImported("CREDIT", "card", "PAYMENT RECEIVED - THANK YOU")).toBe("CARD_PAYMENT");
    expect(classifyImported("DEBIT", "card", "LATE PAYMENT FEE")).toBe("FEE");
    expect(paymentMethodFrom("UPI/412345/SWIGGY", "bank")).toBe("UPI");
    expect(extractReference("NEFT-HDFCN52026100512345-ACME")).toBe("HDFCN52026100512345");
    expect(detectInstitution("Statement from HDFC BANK LIMITED")).toBe("HDFC Bank");
  });
});

describe("PDF statement line parser", () => {
  it("uses the running balance to decide debit/credit and joins wrapped descriptions", () => {
    const lines = [
      "HDFC BANK  Statement of Account",
      "Opening Balance                               10,000.00",
      "01/10/26  01/10/26  NEFT CR-ACME TECHNOLOGIES     85,000.00     95,000.00",
      "SALARY OCT 2026",
      "02/10/26  UPI/412345678901/SWIGGY/swiggy@icici    645.00     94,355.00",
      "03/10/26  ATM CASH WDL MG ROAD                  2,000.00     92,355.00",
      "Page 1 of 2",
    ];
    const r = parseStatementLines(lines, { accountKind: "bank" });
    expect(r.openingBalance).toBe("10000.00");
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ direction: "CREDIT", amount: "85000.00", method: "BALANCE", confidence: 95 });
    expect(r.rows[0].description).toContain("SALARY OCT 2026");
    expect(r.rows[1]).toMatchObject({ direction: "DEBIT", amount: "645.00", referenceNumber: "412345678901" });
    expect(r.rows[2]).toMatchObject({ direction: "DEBIT", amount: "2000.00" });
    expect(r.verifiedShare).toBe(1);
  });

  it("uses Cr markers on card statements and never invents rows", () => {
    const r = parseStatementLines(
      ["05/10/2026 AMAZON PAY INDIA  1,250.00", "06/10/2026 PAYMENT RECEIVED THANK YOU  24,500.00 Cr", "Some legal text without amounts", "07/10/2026 header only no amount"],
      { accountKind: "card" },
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ direction: "DEBIT", method: "CARD_DEFAULT", confidence: 85 });
    expect(r.rows[1]).toMatchObject({ direction: "CREDIT", method: "MARKER" });
  });

  it("marks unverifiable bank rows as low confidence for review", () => {
    const r = parseStatementLines(["05/10/2026 SOME MERCHANT 500.00"], { accountKind: "bank" });
    expect(r.rows[0].confidence).toBeLessThan(80);
  });
});

describe("file readers", () => {
  it("detects file kinds by content and parses CSV with quotes", () => {
    const csv = Buffer.from('Date,Narration,Debit,Credit\n01/10/2026,"SWIGGY, BLR",645.00,\n02/10/2026,SALARY,,"85,000.00"\n');
    expect(detectFileKind(csv, "s.csv")).toBe("CSV");
    expect(detectFileKind(Buffer.from("%PDF-1.7 ..."), "x.pdf")).toBe("PDF");
    expect(detectFileKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), "old.xls")).toBeNull();
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][1]).toBe("SWIGGY, BLR");
    expect(rows[2][3]).toBe("85,000.00");
  });

  it("reads XLSX including date cells and float noise", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Statement");
    ws.addRow(["Txn Date", "Description", "Amount"]);
    ws.addRow([new Date(Date.UTC(2026, 9, 5)), "UBER", 0.1 + 0.2]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(detectFileKind(buf, "s.xlsx")).toBe("XLSX");
    const rows = await parseXlsx(buf);
    expect(rows[1]).toEqual(["2026-10-05", "UBER", "0.3"]);
  });
});
