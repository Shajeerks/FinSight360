import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { Decimal } from "@/lib/money";

/**
 * Full personal data export ("download all of your data"). Read-only.
 * Never includes secrets: password hashes, OAuth/email tokens, raw email bodies,
 * uploaded files or other users' data.
 */

const SECRET_KEYS = new Set([
  "passwordHash", "accessTokenEnc", "refreshTokenEnc", "access_token", "refresh_token", "id_token", "session_state",
  "token", "tokenHash", "syncCursor", "bodyHash", "rawBody", "body", "storageKey",
]);
const DROP_KEYS = new Set(["userId"]);

type Row = Record<string, unknown>;

function cell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // Money is DECIMAL(18,2) (rates have 4 places): exact as a number, so Excel can add it up.
  if (Decimal.isDecimal(v)) return Number((v as Decimal).toString());
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number | boolean;
}

function clean(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (SECRET_KEYS.has(k) || DROP_KEYS.has(k) || k.endsWith("Enc")) continue;
      if (v !== null && typeof v === "object" && !(v instanceof Date) && !Decimal.isDecimal(v)) {
        // flatten one level of related names, e.g. { category: { name } } → category: name
        const name = (v as Row).name ?? (v as Row).nickname ?? (v as Row).cardName;
        if (name !== undefined) {
          out[k] = cell(name);
          continue;
        }
      }
      out[k] = cell(v);
    }
    return out;
  });
}

export type FullExport = { exportedAt: string; app: "FinSight360"; user: Row; sheets: Record<string, Row[]> };

export async function buildFullExport(userId: string): Promise<FullExport> {
  const loans = { loan: { userId } };
  const [
    user, profile, banks, cash, cards, txns, sources, categories, subCategories, rules, budgets, recurring, reminders,
    loanRows, schedule, loanPayments, invAccounts, holdings, invTxns, netWorth, imports, statements, notifications, audit, debtLenders, debtEntries,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true, emailVerified: true, createdAt: true, lastLoginAt: true } }),
    prisma.userProfile.findMany({ where: { userId } }),
    prisma.bankAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.cashAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.creditCard.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      include: { category: { select: { name: true } }, subCategory: { select: { name: true } }, bankAccount: { select: { nickname: true } }, creditCard: { select: { cardName: true } }, cashAccount: { select: { name: true } } },
    }),
    prisma.transactionSource.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
    prisma.subCategory.findMany({ where: { category: { userId } }, include: { category: { select: { name: true } } } }),
    prisma.categorizationRule.findMany({ where: { userId }, include: { category: { select: { name: true } }, subCategory: { select: { name: true } } }, orderBy: { priority: "asc" } }),
    prisma.budget.findMany({ where: { userId }, include: { category: { select: { name: true } } } }),
    prisma.recurringTransaction.findMany({ where: { userId } }),
    prisma.reminder.findMany({ where: { userId }, orderBy: { dueDate: "asc" } }),
    prisma.loan.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.loanAmortizationSchedule.findMany({ where: loans, orderBy: [{ loanId: "asc" }, { installmentNumber: "asc" }], include: { loan: { select: { name: true } } } }),
    prisma.loanPayment.findMany({ where: loans, orderBy: [{ loanId: "asc" }, { paymentDate: "asc" }], include: { loan: { select: { name: true } } } }),
    prisma.investmentAccount.findMany({ where: { userId } }),
    prisma.investmentHolding.findMany({ where: { userId }, include: { investmentAccount: { select: { name: true } } } }),
    prisma.investmentTransaction.findMany({ where: { userId }, orderBy: { tradeDate: "asc" }, include: { investmentAccount: { select: { name: true } } } }),
    prisma.netWorthSnapshot.findMany({ where: { userId }, orderBy: { snapshotDate: "asc" } }),
    prisma.transactionImport.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, sourceType: true, status: true, fileName: true, detectedInstitution: true, importedCount: true, newCount: true, duplicateCount: true, failedCount: true, createdAt: true, completedAt: true } }),
    prisma.statement.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, periodStart: true, periodEnd: true, openingBalance: true, closingBalance: true, status: true, createdAt: true, deletedAt: true } }),
    prisma.notification.findMany({ where: { userId, channel: "IN_APP" }, orderBy: { createdAt: "asc" }, select: { type: true, title: true, body: true, createdAt: true, readAt: true } }),
    prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { action: true, entityType: true, entityId: true, ipAddress: true, userAgent: true, createdAt: true } }),
    prisma.debtLender.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.debtMonthEntry.findMany({ where: { userId }, orderBy: [{ month: "asc" }, { lenderName: "asc" }] }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    app: "FinSight360",
    user: clean([user as Row])[0],
    sheets: {
      Profile: clean(profile as Row[]),
      "Bank accounts": clean(banks as Row[]),
      "Cash wallets": clean(cash as Row[]),
      "Credit cards": clean(cards as Row[]),
      Transactions: clean(txns as Row[]),
      "Transaction sources": clean(sources as Row[]),
      Categories: clean(categories as Row[]),
      "Sub-categories": clean(subCategories as Row[]),
      Rules: clean(rules as Row[]),
      Budgets: clean(budgets as Row[]),
      "Recurring payments": clean(recurring as Row[]),
      Reminders: clean(reminders as Row[]),
      Loans: clean(loanRows as Row[]),
      "Loan schedule": clean(schedule as Row[]),
      "Loan payments": clean(loanPayments as Row[]),
      "Debt lenders": clean(debtLenders as Row[]),
      "Debt tracker entries": clean(debtEntries as Row[]),
      "Investment accounts": clean(invAccounts as Row[]),
      Holdings: clean(holdings as Row[]),
      "Investment transactions": clean(invTxns as Row[]),
      "Net worth history": clean(netWorth as Row[]),
      Imports: clean(imports as Row[]),
      Statements: clean(statements as Row[]),
      Notifications: clean(notifications as Row[]),
      "Activity log": clean(audit as Row[]),
    },
  };
}

/** Excel workbook: a README sheet, then one sheet per table. Cells that look like formulas are neutralised. */
export async function fullExportToXlsx(data: FullExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinSight360";
  wb.created = new Date(data.exportedAt);
  const info = wb.addWorksheet("About");
  info.addRows([
    ["FinSight360 — full data export"],
    ["Exported at", data.exportedAt],
    ["Account", String(data.user.email ?? "")],
    [],
    ["Sheet", "Rows"],
    ...Object.entries(data.sheets).map(([k, v]) => [k, v.length]),
    [],
    ["Not included: passwords, sign-in and mailbox tokens, email contents and uploaded statement files."],
  ]);
  info.getColumn(1).width = 28;
  info.getColumn(2).width = 28;
  for (const [name, rows] of Object.entries(data.sheets)) {
    const ws = wb.addWorksheet(name.slice(0, 31));
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!cols.length) {
      ws.addRow(["(no records)"]);
      continue;
    }
    ws.addRow(cols);
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(cols.map((c) => safeCell(r[c])));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    cols.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function safeCell(v: unknown) {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return `'${v}`;
  return v as ExcelJS.CellValue;
}
