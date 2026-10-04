import "server-only";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { countableWhere } from "@/lib/transactions/countable";
import { Decimal, roundMoney, toDecimal } from "@/lib/money";
import { TYPE_LABELS } from "@/lib/transactions/kinds";
import { valueHolding } from "@/lib/investments/calc";
import { netWorthHistory } from "@/services/networth.service";

/**
 * Tabular reports for a date range, rendered on screen, printed (browser
 * "Save as PDF") or exported to CSV / Excel. Every figure comes from the same
 * countable ledger rules as the dashboard.
 */

export const REPORT_TYPES = ["expenses", "income", "transactions", "cards", "loans", "interest", "investments", "networth"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_LABEL: Record<ReportType, string> = {
  expenses: "Expense report",
  income: "Income report",
  transactions: "Transaction register",
  cards: "Credit-card report",
  loans: "Loan report",
  interest: "Interest report",
  investments: "Investment report",
  networth: "Net-worth report",
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reportQuerySchema = z
  .object({
    type: z.enum(REPORT_TYPES).default("expenses"),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .transform((v) => {
    const now = new Date();
    const from = v.from ? new Date(`${v.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = v.to ? new Date(`${v.to}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { type: v.type, from, to };
  })
  .refine((v) => !Number.isNaN(v.from.getTime()) && !Number.isNaN(v.to.getTime()) && v.from <= v.to, "Choose a valid date range")
  .refine((v) => v.to.getTime() - v.from.getTime() <= 3 * 366 * 86_400_000, "Choose a range of 3 years or less");

export type Column = { key: string; label: string; kind: "text" | "money" | "date" | "number" | "percent" };
export type Report = { type: ReportType; title: string; from: string; to: string; columns: Column[]; rows: Record<string, string | number | null>[]; totals: Record<string, string | number | null> | null; notes: string[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: Decimal | number | string | null | undefined) => (v === null || v === undefined ? null : roundMoney(toDecimal(v)).toFixed(2));
const sumCol = (rows: Record<string, unknown>[], key: string) => roundMoney(rows.reduce((a, r) => a.plus(toDecimal((r[key] as string) ?? 0)), new Decimal(0))).toFixed(2);

export async function buildReport(userId: string, input: unknown): Promise<Report> {
  const q = parseOrThrow(reportQuerySchema, input);
  const range = { gte: q.from, lt: new Date(q.to.getTime() + 86_400_000) };
  const base = { type: q.type, title: REPORT_LABEL[q.type], from: iso(q.from), to: iso(q.to), notes: [] as string[] };

  switch (q.type) {
    case "expenses": {
      const rows = await prisma.transaction.findMany({
        where: countableWhere(userId, { transactionDate: range, OR: [{ direction: "DEBIT", transactionType: { in: ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"] } }, { direction: "CREDIT", transactionType: { in: ["REFUND", "REVERSAL"] } }] }),
        select: { amount: true, direction: true, category: { select: { name: true } }, subCategory: { select: { name: true } } },
      });
      const by = new Map<string, { category: string; sub: string; spent: Decimal; refunds: Decimal; count: number }>();
      for (const t of rows) {
        const k = `${t.category?.name ?? "Uncategorized"}|${t.subCategory?.name ?? ""}`;
        const e = by.get(k) ?? { category: t.category?.name ?? "Uncategorized", sub: t.subCategory?.name ?? "", spent: new Decimal(0), refunds: new Decimal(0), count: 0 };
        if (t.direction === "DEBIT") e.spent = e.spent.plus(t.amount);
        else e.refunds = e.refunds.plus(t.amount);
        e.count++;
        by.set(k, e);
      }
      const total = [...by.values()].reduce((a, e) => a.plus(e.spent).minus(e.refunds), new Decimal(0));
      const out = [...by.values()]
        .map((e) => ({ category: e.category, subCategory: e.sub, transactions: e.count, spent: money(e.spent), refunds: money(e.refunds), net: money(e.spent.minus(e.refunds)), share: total.isZero() ? 0 : e.spent.minus(e.refunds).dividedBy(total).times(100).toDecimalPlaces(1).toNumber() }))
        .sort((a, b) => Number(b.net) - Number(a.net));
      return {
        ...base,
        columns: [{ key: "category", label: "Category", kind: "text" }, { key: "subCategory", label: "Sub-category", kind: "text" }, { key: "transactions", label: "Txns", kind: "number" }, { key: "spent", label: "Spent", kind: "money" }, { key: "refunds", label: "Refunds", kind: "money" }, { key: "net", label: "Net", kind: "money" }, { key: "share", label: "Share %", kind: "percent" }],
        rows: out,
        totals: { category: "Total", transactions: out.reduce((a, r) => a + r.transactions, 0), spent: sumCol(out, "spent"), refunds: sumCol(out, "refunds"), net: sumCol(out, "net"), share: 100 },
        notes: ["Card bill payments, transfers, EMIs and investments aren't expenses and are excluded."],
      };
    }
    case "income": {
      const rows = await prisma.transaction.findMany({
        where: countableWhere(userId, { transactionDate: range, direction: "CREDIT", transactionType: { in: ["INCOME", "INTEREST"] } }),
        select: { amount: true, transactionType: true, income: { select: { incomeCategory: true, sourceName: true } }, merchantName: true, category: { select: { name: true } } },
      });
      const by = new Map<string, { type: string; source: string; amount: Decimal; count: number }>();
      for (const t of rows) {
        const type = t.income?.incomeCategory ?? (t.transactionType === "INTEREST" ? "INTEREST" : "OTHER");
        const source = t.income?.sourceName ?? t.merchantName ?? t.category?.name ?? "—";
        const k = `${type}|${source}`;
        const e = by.get(k) ?? { type, source, amount: new Decimal(0), count: 0 };
        by.set(k, { ...e, amount: e.amount.plus(t.amount), count: e.count + 1 });
      }
      const out = [...by.values()].map((e) => ({ type: e.type.charAt(0) + e.type.slice(1).toLowerCase(), source: e.source, transactions: e.count, amount: money(e.amount) })).sort((a, b) => Number(b.amount) - Number(a.amount));
      return {
        ...base,
        columns: [{ key: "type", label: "Type", kind: "text" }, { key: "source", label: "Source", kind: "text" }, { key: "transactions", label: "Txns", kind: "number" }, { key: "amount", label: "Amount", kind: "money" }],
        rows: out,
        totals: { type: "Total", transactions: out.reduce((a, r) => a + r.transactions, 0), amount: sumCol(out, "amount") },
      };
    }
    case "transactions": {
      const rows = await prisma.transaction.findMany({
        where: countableWhere(userId, { transactionDate: range }),
        orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
        take: 20_000,
        select: {
          transactionDate: true, description: true, merchantName: true, amount: true, direction: true, transactionType: true, referenceNumber: true, sourceType: true,
          category: { select: { name: true } }, subCategory: { select: { name: true } },
          bankAccount: { select: { nickname: true } }, creditCard: { select: { cardName: true, last4: true } }, cashAccount: { select: { name: true } },
        },
      });
      const out = rows.map((t) => ({
        date: iso(t.transactionDate),
        description: t.description,
        merchant: t.merchantName ?? "",
        type: TYPE_LABELS[t.transactionType] ?? t.transactionType,
        account: t.bankAccount?.nickname ?? (t.creditCard ? `${t.creditCard.cardName} ••${t.creditCard.last4}` : (t.cashAccount?.name ?? "")),
        category: [t.category?.name, t.subCategory?.name].filter(Boolean).join(" › "),
        debit: t.direction === "DEBIT" ? money(t.amount) : null,
        credit: t.direction === "CREDIT" ? money(t.amount) : null,
        reference: t.referenceNumber ?? "",
        source: t.sourceType,
      }));
      return {
        ...base,
        columns: [{ key: "date", label: "Date", kind: "date" }, { key: "description", label: "Description", kind: "text" }, { key: "merchant", label: "Merchant", kind: "text" }, { key: "type", label: "Type", kind: "text" }, { key: "account", label: "Account", kind: "text" }, { key: "category", label: "Category", kind: "text" }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }, { key: "reference", label: "Reference", kind: "text" }, { key: "source", label: "Source", kind: "text" }],
        rows: out,
        totals: { date: "Total", debit: sumCol(out, "debit"), credit: sumCol(out, "credit") },
        notes: rows.length >= 20_000 ? ["Showing the first 20,000 transactions — choose a shorter range for the rest."] : [],
      };
    }
    case "cards": {
      const cards = await prisma.creditCard.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } });
      const out = [];
      for (const c of cards) {
        const g = await prisma.transaction.groupBy({ by: ["direction", "transactionType"], where: countableWhere(userId, { creditCardId: c.id, transactionDate: range }), _sum: { amount: true } });
        const val = (pred: (x: (typeof g)[number]) => boolean) => g.filter(pred).reduce((a, x) => a.plus(x._sum.amount ?? 0), new Decimal(0));
        const purchases = val((x) => x.direction === "DEBIT" && x.transactionType !== "CARD_PAYMENT" && x.transactionType !== "FEE");
        const fees = val((x) => x.direction === "DEBIT" && x.transactionType === "FEE");
        const refunds = val((x) => x.direction === "CREDIT" && x.transactionType !== "CARD_PAYMENT");
        const payments = val((x) => x.transactionType === "CARD_PAYMENT");
        out.push({
          card: `${c.bankName} ${c.cardName} ••${c.last4}`, purchases: money(purchases), fees: money(fees), refunds: money(refunds), payments: money(payments),
          outstanding: money(c.currentOutstanding), limit: money(c.creditLimit),
          utilization: c.creditLimit.isZero() ? 0 : c.currentOutstanding.dividedBy(c.creditLimit).times(100).toDecimalPlaces(1).toNumber(),
        });
      }
      return {
        ...base,
        columns: [{ key: "card", label: "Card", kind: "text" }, { key: "purchases", label: "Purchases", kind: "money" }, { key: "fees", label: "Fees", kind: "money" }, { key: "refunds", label: "Refunds", kind: "money" }, { key: "payments", label: "Payments", kind: "money" }, { key: "outstanding", label: "Outstanding now", kind: "money" }, { key: "limit", label: "Limit", kind: "money" }, { key: "utilization", label: "Utilization %", kind: "percent" }],
        rows: out,
        totals: { card: "Total", purchases: sumCol(out, "purchases"), fees: sumCol(out, "fees"), refunds: sumCol(out, "refunds"), payments: sumCol(out, "payments"), outstanding: sumCol(out, "outstanding"), limit: sumCol(out, "limit") },
      };
    }
    case "loans":
    case "interest": {
      const loans = await prisma.loan.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } });
      const out = [];
      for (const l of loans) {
        const p = await prisma.loanPayment.aggregate({ where: { loanId: l.id, deletedAt: null, paymentDate: range }, _sum: { amount: true, principalComponent: true, interestComponent: true, chargesComponent: true }, _count: true });
        out.push({
          loan: `${l.name} · ${l.lender}`, rate: l.interestRate.toNumber(), payments: p._count, paid: money(p._sum.amount ?? 0),
          principal: money(p._sum.principalComponent ?? 0), interest: money(p._sum.interestComponent ?? 0), charges: money(p._sum.chargesComponent ?? 0),
          outstanding: money(l.outstandingPrincipal), status: l.status,
        });
      }
      if (q.type === "interest") {
        const earned = await prisma.transaction.aggregate({ where: countableWhere(userId, { transactionDate: range, direction: "CREDIT", transactionType: "INTEREST" }), _sum: { amount: true } });
        const rows = [
          ...out.map((r) => ({ item: `Interest paid — ${r.loan}`, kind: "Paid", amount: r.interest })),
          { item: "Interest earned (savings / FD)", kind: "Earned", amount: money(earned._sum.amount ?? 0) },
        ];
        const paid = sumCol(out, "interest");
        return {
          ...base,
          columns: [{ key: "item", label: "Item", kind: "text" }, { key: "kind", label: "Paid / earned", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }],
          rows,
          totals: { item: "Net interest (earned − paid)", amount: money(toDecimal(earned._sum.amount ?? 0).minus(paid)) },
          notes: ["Loan interest is taken from recorded EMI payments (their interest component)."],
        };
      }
      return {
        ...base,
        columns: [{ key: "loan", label: "Loan", kind: "text" }, { key: "rate", label: "Rate %", kind: "percent" }, { key: "payments", label: "Payments", kind: "number" }, { key: "paid", label: "Paid", kind: "money" }, { key: "principal", label: "Principal", kind: "money" }, { key: "interest", label: "Interest", kind: "money" }, { key: "charges", label: "Charges", kind: "money" }, { key: "outstanding", label: "Outstanding now", kind: "money" }, { key: "status", label: "Status", kind: "text" }],
        rows: out,
        totals: { loan: "Total", payments: out.reduce((a, r) => a + r.payments, 0), paid: sumCol(out, "paid"), principal: sumCol(out, "principal"), interest: sumCol(out, "interest"), charges: sumCol(out, "charges"), outstanding: sumCol(out, "outstanding") },
      };
    }
    case "investments": {
      const holdings = await prisma.investmentHolding.findMany({ where: { userId, deletedAt: null, investmentAccount: { deletedAt: null } }, include: { investmentAccount: { select: { name: true } } }, orderBy: { instrumentName: "asc" } });
      const txns = await prisma.investmentTransaction.groupBy({ by: ["holdingId", "type"], where: { userId, deletedAt: null, tradeDate: range }, _sum: { amount: true } });
      const out = holdings.filter((h) => h.quantity.greaterThan(0)).map((h) => {
        const v = valueHolding(h);
        const flow = (types: string[]) => txns.filter((t) => t.holdingId === h.id && types.includes(t.type)).reduce((a, t) => a.plus(t._sum.amount ?? 0), new Decimal(0));
        return {
          account: h.investmentAccount.name, instrument: h.instrumentName, type: h.instrumentType, units: h.quantity.toNumber(),
          invested: money(v.invested), value: money(v.current), gain: money(v.gain), gainPct: v.gainPct?.toNumber() ?? null,
          boughtInPeriod: money(flow(["BUY", "SIP", "SWITCH_IN"])), soldInPeriod: money(flow(["SELL", "REDEMPTION", "SWITCH_OUT"])), dividends: money(flow(["DIVIDEND"])),
        };
      });
      return {
        ...base,
        columns: [{ key: "account", label: "Account", kind: "text" }, { key: "instrument", label: "Instrument", kind: "text" }, { key: "type", label: "Type", kind: "text" }, { key: "units", label: "Units", kind: "number" }, { key: "invested", label: "Invested", kind: "money" }, { key: "value", label: "Value", kind: "money" }, { key: "gain", label: "Gain", kind: "money" }, { key: "gainPct", label: "Gain %", kind: "percent" }, { key: "boughtInPeriod", label: "Bought (period)", kind: "money" }, { key: "soldInPeriod", label: "Sold (period)", kind: "money" }, { key: "dividends", label: "Dividends (period)", kind: "money" }],
        rows: out,
        totals: { account: "Total", invested: sumCol(out, "invested"), value: sumCol(out, "value"), gain: sumCol(out, "gain"), boughtInPeriod: sumCol(out, "boughtInPeriod"), soldInPeriod: sumCol(out, "soldInPeriod"), dividends: sumCol(out, "dividends") },
        notes: ["Holdings are valued at the latest known price."],
      };
    }
    case "networth": {
      const hist = (await netWorthHistory(userId, 120)).filter((h) => h.date >= iso(q.from) && h.date <= iso(q.to));
      const rows = hist.map((h) => ({ date: h.date, assets: money(h.assets), liabilities: money(h.liabilities), netWorth: money(h.netWorth) }));
      return {
        ...base,
        columns: [{ key: "date", label: "Date", kind: "date" }, { key: "assets", label: "Assets", kind: "money" }, { key: "liabilities", label: "Liabilities", kind: "money" }, { key: "netWorth", label: "Net worth", kind: "money" }],
        rows,
        totals: null,
        notes: ["Snapshots are recorded daily while FinSight360 runs."],
      };
    }
  }
}

/** CSV-injection safe cell (Excel would run "=…" as a formula). */
function csvCell(v: string | number | null | undefined) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: Report): string {
  const lines = [r.columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row[c.key])).join(","));
  if (r.totals) lines.push(r.columns.map((c) => csvCell(r.totals![c.key] ?? "")).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export async function reportToXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinSight360";
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([`${r.title} · ${r.from} to ${r.to}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F3EF" } }));
  const cellValue = (c: Column, v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === "") return null;
    if (c.kind === "money" || c.kind === "number" || c.kind === "percent") return Number(v);
    if (c.kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => cellValue(c, row[c.key])));
  if (r.totals) ws.addRow(r.columns.map((c) => cellValue(c, r.totals![c.key]))).font = { bold: true };
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.kind === "text" ? 28 : 16;
    if (c.kind === "money") col.numFmt = "#,##,##0.00";
    if (c.kind === "date") col.numFmt = "dd-mmm-yyyy";
    if (c.kind === "percent") col.numFmt = "0.0";
  });
  for (const n of r.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
