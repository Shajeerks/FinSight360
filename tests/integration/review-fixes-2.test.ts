import ExcelJS from "exceljs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/security/encryption";
import { setMailProviderOverride, type MailProvider } from "@/lib/email/providers";
import { createBankAccount } from "@/services/account.service";
import { disconnectEmail, syncEmailConnection } from "@/services/email.service";
import { addInvestmentTransaction, createHolding, createInvestmentAccount, deleteHolding, deleteInvestmentAccount, getHoldingDetail, updateHoldingPrice } from "@/services/investment.service";
import { importInvestmentFile } from "@/services/groww.service";
import { createLoan, deleteLoanPayment, recordLoanPayment } from "@/services/loan.service";
import { meta, resetDatabase } from "./helpers";

/** Regression tests for the Phase 1–6 review (fourth pass). */

async function xlsx(rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("R");
  rows.forEach((r) => ws.addRow(r));
  return { name: "g.xlsx", buffer: Buffer.from(await wb.xlsx.writeBuffer()) };
}
const ORDERS = [
  ["Stock name", "Symbol", "ISIN", "Type", "Quantity", "Value", "Exchange Order Id", "Execution date and time", "Order status"],
  ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "BUY", 5, 17250, "1100000012345678", "05-08-2026 10:12 AM", "Executed"],
  ["TATA CONSULTANCY SERVICES", "TCS", "INE467B01029", "BUY", 1, 3500, "1100000012345679", "06-08-2026 10:12 AM", "Executed"],
];

describe("review fixes, fourth pass (integration)", () => {
  let userId: string;
  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "r4@example.com" } })).id;
  });
  afterEach(() => setMailProviderOverride("GMAIL", null));
  afterAll(() => prisma.$disconnect());

  it("a disconnect during a sync wins: tokens stay wiped and the mailbox stays disconnected", async () => {
    await createBankAccount(userId, { bankName: "HDFC", nickname: "Main", accountType: "SAVINGS", last4: "4821", currentBalance: "1000" }, meta);
    const conn = await prisma.emailConnection.create({ data: { userId, provider: "GMAIL", emailAddress: "a@gmail.com", accessTokenEnc: encryptSecret("a"), refreshTokenEnc: encryptSecret("r"), tokenExpiresAt: new Date(Date.now() - 1000) } });
    const fake: MailProvider = {
      name: "GMAIL", scopes: "", configured: () => true, authUrl: () => "", exchangeCode: async () => ({ accessToken: "", expiresAt: new Date() }),
      refresh: async () => {
        await disconnectEmail(userId, conn.id, {}, meta); // user disconnects while we refresh
        return { accessToken: "new", refreshToken: "new-r", expiresAt: new Date(Date.now() + 3600_000) };
      },
      profileEmail: async () => "a@gmail.com", revoke: async () => undefined,
      client: () => ({ listBankMessageIds: async () => ["m1"], getMessage: async () => ({ id: "m1", threadId: null, from: "alerts@hdfcbank.net", subject: "x", receivedAt: new Date(), text: "Rs.10.00 debited from account **4821" }) }),
    };
    setMailProviderOverride("GMAIL", fake);
    await expect(syncEmailConnection(userId, conn.id, {}, meta)).rejects.toMatchObject({ code: "DISCONNECTED" });
    const c = await prisma.emailConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(c.status).toBe("DISCONNECTED");
    expect(c.accessTokenEnc).toBeNull();
    expect(c.refreshTokenEnc).toBeNull();
  });

  it("manual prices are private to their owner", async () => {
    const acct = (await createInvestmentAccount(userId, { name: "Mine" }, meta)).id;
    const h = await createHolding(userId, { investmentAccountId: acct, instrumentName: "My private FD at XYZ", instrumentType: "FIXED_DEPOSIT", quantity: "1", averageBuyPrice: "500000" }, meta);
    await updateHoldingPrice(userId, h.id, { currentPrice: "512345.67" }, meta);
    const other = (await prisma.user.create({ data: { email: "o@example.com" } })).id;
    const oAcct = (await createInvestmentAccount(other, { name: "Theirs" }, meta)).id;
    const oh = await createHolding(other, { investmentAccountId: oAcct, instrumentName: "My private FD at XYZ", instrumentType: "FIXED_DEPOSIT", quantity: "1", averageBuyPrice: "1" }, meta);
    expect((await getHoldingDetail(other, oh.id)).prices).toHaveLength(0);
    expect((await getHoldingDetail(userId, h.id)).prices).toHaveLength(1);
  });

  it("order history can be re-imported after the holding or the account was removed", async () => {
    const acct = (await createInvestmentAccount(userId, { name: "Groww" }, meta)).id;
    const file = await xlsx(ORDERS);
    await importInvestmentFile(userId, acct, file, { commit: true }, meta);
    const h = await prisma.investmentHolding.findFirstOrThrow({ where: { userId } });
    await deleteHolding(userId, h.id, meta);
    const again = await importInvestmentFile(userId, acct, file, { commit: true }, meta);
    expect(again.transactions.every((t) => !t.duplicate)).toBe(true);
    expect((await prisma.investmentHolding.findFirstOrThrow({ where: { userId, deletedAt: null } })).quantity.toString()).toBe("6");

    await deleteInvestmentAccount(userId, acct, meta);
    const acct2 = (await createInvestmentAccount(userId, { name: "Groww 2" }, meta)).id;
    await importInvestmentFile(userId, acct2, file, { commit: true }, meta);
    const h2 = await prisma.investmentHolding.findFirstOrThrow({ where: { investmentAccountId: acct2 } });
    expect(h2.quantity.toString()).toBe("6");
    expect(await prisma.investmentTransaction.count({ where: { userId, deletedAt: null } })).toBe(2);
  });

  it("importing the full history replaces the auto 'opening position' and matching manual entries", async () => {
    const acct = (await createInvestmentAccount(userId, { name: "Groww" }, meta)).id;
    const h = await createHolding(userId, { investmentAccountId: acct, instrumentName: "TATA CONSULTANCY SERVICES", instrumentType: "STOCK", isin: "INE467B01029", quantity: "5", investedAmount: "17250" }, meta);
    await addInvestmentTransaction(userId, { investmentAccountId: acct, holdingId: h.id, type: "BUY", tradeDate: "2026-08-06", quantity: "1", amount: "3500" }, meta);
    const r = await importInvestmentFile(userId, acct, await xlsx(ORDERS), { commit: true }, meta);
    expect(r.warnings.length).toBeGreaterThan(0);
    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } });
    expect(after.quantity.toString()).toBe("6");
    expect(after.investedAmount.toFixed(2)).toBe("20750.00");
  });

  it("bad values in files or forms are validation errors, not crashes", async () => {
    const acct = (await createInvestmentAccount(userId, { name: "Groww" }, meta)).id;
    const r = await importInvestmentFile(userId, acct, await xlsx([
      ["Stock Name", "ISIN", "Quantity", "Average buy price"],
      ["WEIRD CO", "NOT AVAILABLE", 10, 100],
      ["HUGE CO", "INE000A01011", 999999999999, 999999999],
    ]), { commit: true }, meta);
    expect(r.skipped.map((s) => s.reason)).toContain("Value out of range");
    expect((await prisma.investmentHolding.findFirstOrThrow({ where: { instrumentName: "WEIRD CO" } })).isin).toBeNull();
    await expect(createHolding(userId, { investmentAccountId: acct, instrumentName: "Huge", instrumentType: "STOCK", quantity: "999999999999", averageBuyPrice: "999999999" }, meta)).rejects.toMatchObject({ status: 422 });
  });

  it("an EMI after a part payment finishes that instalment and pays the next; undo removes both parts", async () => {
    const bankId = (await createBankAccount(userId, { bankName: "HDFC", nickname: "Main", accountType: "SAVINGS", currentBalance: "100000" }, meta)).id;
    const loan = await createLoan(userId, { name: "Bike loan", lender: "HDFC", loanType: "PERSONAL", principal: "120000", interestRate: "12", tenureMonths: 12, startDate: "2026-01-01", firstEmiDate: "2026-02-05" }, meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: "2026-02-05", amount: "5000", recordInLedger: false }, meta);
    await recordLoanPayment(userId, loan.id, { paymentType: "EMI", paymentDate: "2026-02-20", amount: "10661.85", account: `bank:${bankId}` }, meta);
    const rows = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: loan.id }, orderBy: { installmentNumber: "asc" }, take: 2 });
    expect(rows.map((r) => r.status)).toEqual(["PAID", "PARTIALLY_PAID"]);
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    // #1 fully paid (incl. ₹1,200 interest); ₹5,000 goes to #2, whose interest (₹1,162 on the re-projected 1,16,200) is charged first.
    expect(l.outstandingPrincipal.toFixed(2)).toBe("106700.15");
    const part = await prisma.loanPayment.findFirstOrThrow({ where: { loanId: loan.id, transactionId: { not: null } } });
    await deleteLoanPayment(userId, loan.id, part.id, meta);
    expect(await prisma.loanPayment.count({ where: { loanId: loan.id, deletedAt: null } })).toBe(1);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2)).toBe("100000.00");
  });
});
