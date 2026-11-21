import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/security/encryption";
import { setMailProviderOverride, type MailClient, type MailProvider, type StatementMail } from "@/lib/email/providers";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { dismissEmailStatement, importEmailStatement, listEmailStatements, syncEmailConnection } from "@/services/email.service";
import { meta, resetDatabase } from "./helpers";

const fixture = (f: string) => readFileSync(path.join(__dirname, "..", "fixtures", f));
const CSV = Buffer.from(
  ["Date,Narration,Withdrawal,Deposit,Balance", "01/10/2026,UPI-SWIGGY,450.00,,49550.00", "02/10/2026,SALARY ACME,,85000.00,134550.00", "03/10/2026,ATM WDL,2000.00,,132550.00"].join("\n"),
);

/** A fake mailbox holding statement emails. */
class StatementBox implements MailProvider {
  readonly name = "GMAIL" as const;
  readonly scopes = "";
  mails: (StatementMail & { content: Record<string, Buffer> })[] = [];
  downloads = 0;
  configured = () => true;
  authUrl = () => "";
  exchangeCode = async () => ({ accessToken: "a", expiresAt: new Date(Date.now() + 3600_000) });
  refresh = async () => ({ accessToken: "a", expiresAt: new Date(Date.now() + 3600_000) });
  profileEmail = async () => "me@gmail.com";
  revoke = async () => undefined;
  client(): MailClient {
    return {
      listBankMessageIds: async () => [],
      getMessage: async () => {
        throw new Error("no alerts");
      },
      listStatementMessageIds: async () => this.mails.map((m) => m.id).reverse(),
      getStatementMail: async (id) => this.mails.find((m) => m.id === id)!,
      downloadAttachment: async (id, f) => {
        this.downloads++;
        return this.mails.find((m) => m.id === id)!.content[f.fileName];
      },
    };
  }
  add(id: string, subject: string, fileName: string, content: Buffer, from = "HDFC Bank <estatement@hdfcbank.net>") {
    this.mails.push({ id, from, subject, receivedAt: new Date(), files: [{ ref: `att-${id}`, fileName, mimeType: null, size: content.length }], content: { [fileName]: content } });
  }
}

describe("Statements from email (integration)", () => {
  let userId: string;
  let bankId: string;
  let connId: string;
  let box: StatementBox;

  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "st@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", last4: "4821", currentBalance: "50000" }, meta)).id;
    await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "300000", currentOutstanding: "0" }, meta);
    box = new StatementBox();
    setMailProviderOverride("GMAIL", box);
    connId = (await prisma.emailConnection.create({ data: { userId, provider: "GMAIL", emailAddress: "me@gmail.com", accessTokenEnc: encryptSecret("a"), tokenExpiresAt: new Date(Date.now() + 3600_000) } })).id;
  });
  afterEach(() => setMailProviderOverride("GMAIL", null));
  afterAll(() => prisma.$disconnect());

  it("an unlocked statement for a recognised account is read straight into an import awaiting review; it's listed only once", async () => {
    box.add("s1", "Your HDFC Bank account XX4821 statement for October", "Acct_Statement_XX4821.csv", CSV);
    const s = await syncEmailConnection(userId, connId, {}, meta);
    expect(s).toMatchObject({ statements: 1, statementsImported: 1, failed: 0 });
    const st = await prisma.emailStatement.findFirstOrThrow({ where: { userId } });
    expect(st).toMatchObject({ status: "IMPORTED", suggestedAccount: `bank:${bankId}`, needsPassword: false });
    const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: st.importId! } });
    expect(imp.status).toBe("AWAITING_MAPPING"); // CSV: you confirm the columns, then the rows — nothing in the ledger yet
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);

    const again = await syncEmailConnection(userId, connId, {}, meta);
    expect(again.statements).toBe(0);
    expect(await prisma.emailStatement.count()).toBe(1);
    expect((await listEmailStatements(userId)).recent).toHaveLength(1);
  });

  it("a locked PDF waits for the account and password; the password is checked and never stored", async () => {
    box.add("s2", "e-Statement", "statement.pdf", fixture("bank-statement-locked.pdf"), "Bank <statements@kotak.com>");
    const s = await syncEmailConnection(userId, connId, {}, meta);
    expect(s).toMatchObject({ statements: 1, statementsImported: 0 });
    const st = await prisma.emailStatement.findFirstOrThrow({ where: { userId } });
    expect(st).toMatchObject({ status: "PENDING", suggestedAccount: null });
    expect((await listEmailStatements(userId)).pending).toHaveLength(1);

    await expect(importEmailStatement(userId, st.id, { account: `bank:${bankId}`, password: "nope" }, meta)).rejects.toMatchObject({ code: "PDF_PASSWORD_INCORRECT" });
    expect((await prisma.emailStatement.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("PENDING");
    const r = await importEmailStatement(userId, st.id, { account: `bank:${bankId}`, password: "FS1234" }, meta);
    expect(r.importId).toBeTruthy();
    const done = await prisma.emailStatement.findUniqueOrThrow({ where: { id: st.id } });
    expect(done).toMatchObject({ status: "IMPORTED", importId: r.importId });
    expect(JSON.stringify(done)).not.toContain("FS1234");
    expect((await prisma.transactionImport.findUniqueOrThrow({ where: { id: r.importId } })).status).toBe("AWAITING_REVIEW");
    // Asking again returns the same import instead of reading it twice.
    expect((await importEmailStatement(userId, st.id, { account: `bank:${bankId}` }, meta)).importId).toBe(r.importId);
  });

  it("a locked PDF for a recognised account is marked as needing a password; ignore removes it from the list", async () => {
    box.add("s3", "Statement for account ending 4821", "stmt.pdf", fixture("bank-statement-locked.pdf"));
    await syncEmailConnection(userId, connId, {}, meta);
    const st = await prisma.emailStatement.findFirstOrThrow({ where: { userId } });
    expect(st).toMatchObject({ status: "PENDING", needsPassword: true, suggestedAccount: `bank:${bankId}` });
    await dismissEmailStatement(userId, st.id, meta);
    expect((await listEmailStatements(userId)).pending).toHaveLength(0);
    await expect(dismissEmailStatement(userId, st.id, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("another user can't read or ignore your statements", async () => {
    box.add("s4", "e-Statement", "statement.pdf", fixture("bank-statement-locked.pdf"));
    await syncEmailConnection(userId, connId, {}, meta);
    const st = await prisma.emailStatement.findFirstOrThrow({ where: { userId } });
    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    await expect(importEmailStatement(other, st.id, { account: `bank:${bankId}`, password: "FS1234" }, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(dismissEmailStatement(other, st.id, meta)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
