import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/security/encryption";
import { MailAuthError, setMailProviderOverride, type MailProvider, type RawMail } from "@/lib/email/providers";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { applyMapping, commitImport, createImport } from "@/services/import.service";
import { completeConnect, disconnectEmail, listEmailCandidates, resolveEmailCandidate, startConnect, syncEmailConnection } from "@/services/email.service";
import { listDuplicateCandidates } from "@/services/duplicate.service";
import { countableWhere } from "@/lib/transactions/countable";
import { DEFAULT_CATEGORIES } from "@/lib/categories/defaults";
import { meta, resetDatabase } from "./helpers";

const NOW = Date.now();
const day = (n: number) => new Date(NOW - n * 86_400_000);
const ddmmyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCFullYear()).slice(2)}`;
const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/** A fake mailbox standing in for Gmail. */
class FakeMailbox implements MailProvider {
  readonly name = "GMAIL" as const;
  readonly scopes = "gmail.readonly";
  mails: RawMail[] = [];
  revoked: string[] = [];
  refreshCalls = 0;
  failAuth = false;
  configured() {
    return true;
  }
  authUrl({ state }: { state: string }) {
    return `https://accounts.example/auth?state=${state}`;
  }
  async exchangeCode() {
    return { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: new Date(Date.now() + 3600_000) };
  }
  async refresh() {
    this.refreshCalls++;
    if (this.failAuth) throw new MailAuthError("revoked");
    return { accessToken: "access-2", expiresAt: new Date(Date.now() + 3600_000) };
  }
  async profileEmail() {
    return "me@gmail.com";
  }
  async revoke(token: string) {
    this.revoked.push(token);
  }
  client() {
    return {
      listBankMessageIds: async () => this.mails.map((m) => m.id).reverse(),
      getMessage: async (id: string) => this.mails.find((m) => m.id === id)!,
    };
  }
  add(id: string, text: string, receivedAt = day(0), from = "HDFC Bank InstaAlerts <alerts@hdfcbank.net>", subject = "Alert") {
    this.mails.push({ id, threadId: null, from, subject, receivedAt, text });
  }
}

async function seedCategories() {
  for (const c of DEFAULT_CATEGORIES) {
    const cat = await prisma.category.create({ data: { name: c.name, kind: c.kind, color: c.color, isFixed: c.isFixed ?? false, isSystem: true } });
    if (c.subCategories.length) await prisma.subCategory.createMany({ data: c.subCategories.map((name) => ({ categoryId: cat.id, name, isSystem: true })) });
  }
}

describe("Phase 5 email sync (integration)", () => {
  let userId: string;
  let bankId: string;
  let cardId: string;
  let connId: string;
  let box: FakeMailbox;
  const bank = async () => (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankId } })).currentBalance.toFixed(2);
  const card = async () => (await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).currentOutstanding.toFixed(2);

  beforeEach(async () => {
    await resetDatabase();
    await seedCategories();
    userId = (await prisma.user.create({ data: { email: "mail@example.com" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
    bankId = (await createBankAccount(userId, { bankName: "HDFC Bank", nickname: "Salary", accountType: "SALARY", last4: "4821", currentBalance: "50000" }, meta)).id;
    cardId = (await createCreditCard(userId, { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "300000", currentOutstanding: "30000" }, meta)).id;
    box = new FakeMailbox();
    setMailProviderOverride("GMAIL", box);
    const c = await prisma.emailConnection.create({
      data: { userId, provider: "GMAIL", emailAddress: "me@gmail.com", accessTokenEnc: encryptSecret("access-0"), refreshTokenEnc: encryptSecret("refresh-0"), tokenExpiresAt: new Date(Date.now() - 1000) },
    });
    connId = c.id;
  });
  afterEach(() => setMailProviderOverride("GMAIL", null));
  afterAll(() => prisma.$disconnect());

  it("syncs alerts into the ledger, skips non-transactions, and never imports a message twice", async () => {
    box.add("m1", `Dear Customer, Rs.645.00 has been debited from account **4821 to VPA swiggy@icici SWIGGY on ${ddmmyy(day(1))}. Your UPI transaction reference number is 412345678901.`, day(1));
    box.add("m2", `Thank you for using your HDFC Bank Credit Card ending 1043 for Rs 1,250.00 at AMAZON PAY INDIA on ${ddmmyyyy(day(1))} 14:32:11.`, day(1));
    box.add("m3", "Your OTP for transaction of Rs.1250.00 at AMAZON is 123456. Do not share it.");
    box.add("m4", `Rs.300.00 has been debited from account **9999 to VPA tea@ybl CHAI POINT on ${ddmmyy(day(0))}.`);
    const s = await syncEmailConnection(userId, connId, {}, meta);
    expect(s).toMatchObject({ fetched: 4, transactions: 2, notFinancial: 1, needsAccount: 1, failed: 0 });
    expect(box.refreshCalls).toBe(1); // expired access token refreshed
    expect(await bank()).toBe("49355.00");
    expect(await card()).toBe("31250.00");
    const swiggy = await prisma.transaction.findFirstOrThrow({ where: { userId, amount: "645.00" }, include: { sources: true, category: true } });
    expect(swiggy.sources[0]).toMatchObject({ sourceType: "GMAIL", externalId: "GMAIL:m1" });
    expect(swiggy.category?.name).toBe("Food");
    const msg = await prisma.emailMessage.findFirstOrThrow({ where: { providerMessageId: "m1" } });
    expect(msg.bodySha256).toHaveLength(64);
    expect(JSON.stringify(msg)).not.toContain("swiggy@icici"); // body never stored
    const conn = await prisma.emailConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(conn.accessTokenEnc).not.toContain("access-2");

    const again = await syncEmailConnection(userId, connId, {}, meta);
    expect(again.fetched).toBe(0);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(2);

    // The unplaced alert waits for an account; approving it with one creates the transaction.
    const pending = await listEmailCandidates(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].note).toContain("9999");
    await resolveEmailCandidate(userId, pending[0].id, { action: "APPROVE", account: `bank:${bankId}` }, meta);
    expect(await bank()).toBe("49055.00");
    await expect(resolveEmailCandidate(userId, pending[0].id, { action: "REJECT" }, meta)).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
  });

  it("ACCEPTANCE §47 both ways: email + statement row = one transaction with two sources, counted once", async () => {
    // Email first …
    box.add("m1", `Thank you for using your HDFC Bank Credit Card ending 1043 for Rs 1,250.00 at AMAZON PAY INDIA on ${ddmmyyyy(day(2))}.`, day(2));
    await syncEmailConnection(userId, connId, {}, meta);
    const csv = ["Transaction Date,Details,Amount", `${ddmmyyyy(day(2))},AMAZON PAY INDIA PVT LTD,1250.00`].join("\n");
    const up = await createImport(userId, { file: { name: "card.csv", type: "text/csv", buffer: Buffer.from(csv) }, account: `card:${cardId}` }, meta);
    const imp = await prisma.transactionImport.findUniqueOrThrow({ where: { id: up.id } });
    const m = imp.columnMapping as { fields: Record<string, number> };
    await applyMapping(userId, up.id, { headerRowIndex: imp.headerRowIndex, dateFormat: imp.dateFormat, amountMode: imp.amountMode, positiveIs: "DEBIT", ...m.fields }, meta);
    expect((await commitImport(userId, up.id, meta)).linked).toBe(1);
    // … then a statement-first case on the bank account.
    const bankCsv = ["Date,Narration,Debit,Credit", `${ddmmyyyy(day(1))},UPI/412345678901/SWIGGY/swiggy@icici,645.00,`].join("\n");
    const up2 = await createImport(userId, { file: { name: "bank.csv", type: "text/csv", buffer: Buffer.from(bankCsv) }, account: `bank:${bankId}` }, meta);
    const imp2 = await prisma.transactionImport.findUniqueOrThrow({ where: { id: up2.id } });
    const m2 = imp2.columnMapping as { fields: Record<string, number> };
    await applyMapping(userId, up2.id, { headerRowIndex: imp2.headerRowIndex, dateFormat: imp2.dateFormat, amountMode: imp2.amountMode, ...m2.fields }, meta);
    await commitImport(userId, up2.id, meta);
    box.add("m2", `Dear Customer, Rs.645.00 has been debited from account **4821 to VPA swiggy@icici SWIGGY on ${ddmmyy(day(1))}. Your UPI transaction reference number is 412345678901.`, day(1));
    const s = await syncEmailConnection(userId, connId, {}, meta);
    expect(s.linked).toBe(1);

    for (const amount of ["1250.00", "645.00"]) {
      const rows = await prisma.transaction.findMany({ where: countableWhere(userId, { amount }), include: { sources: true } });
      expect(rows).toHaveLength(1);
      expect(rows[0].sources.map((x) => x.sourceType).sort()).toEqual(amount === "645.00" ? ["CSV", "GMAIL"] : ["CSV", "GMAIL"]);
    }
    expect(await card()).toBe("31250.00");
    expect(await bank()).toBe("49355.00");
  });

  it("two identical alerts are two transactions — the second waits as a possible duplicate", async () => {
    const text = `Thank you for using your HDFC Bank Credit Card ending 1043 for Rs 180.00 at STARBUCKS on ${ddmmyyyy(day(0))}.`;
    box.add("c1", text);
    box.add("c2", text);
    await syncEmailConnection(userId, connId, {}, meta);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(2);
    expect(await listDuplicateCandidates(userId)).toHaveLength(1);
    expect(await card()).toBe("30180.00");
  });

  it("revoked access marks the mailbox for reconnection", async () => {
    box.failAuth = true;
    await expect(syncEmailConnection(userId, connId, {}, meta)).rejects.toMatchObject({ code: "RECONNECT_REQUIRED" });
    const c = await prisma.emailConnection.findUniqueOrThrow({ where: { id: connId } });
    expect(c.status).toBe("EXPIRED");
    expect((await prisma.emailSyncJob.findFirstOrThrow()).status).toBe("FAILED");
  });

  it("OAuth: state is bound to the user and tokens are stored encrypted; disconnect revokes and wipes", async () => {
    const { url, cookie } = startConnect(userId, "GMAIL");
    const state = new URL(url).searchParams.get("state");
    const other = (await prisma.user.create({ data: { email: "x@example.com" } })).id;
    await expect(completeConnect(other, "GMAIL", { code: "c", state, error: null, cookie }, meta)).rejects.toMatchObject({ code: "OAUTH_STATE" });
    await expect(completeConnect(userId, "GMAIL", { code: "c", state: "tampered", error: null, cookie }, meta)).rejects.toMatchObject({ code: "OAUTH_STATE" });
    await expect(completeConnect(userId, "GMAIL", { code: null, state: null, error: "access_denied", cookie }, meta)).rejects.toMatchObject({ code: "OAUTH_DENIED" });
    const conn = await completeConnect(userId, "GMAIL", { code: "c", state, error: null, cookie }, meta);
    expect(conn.id).toBe(connId); // same mailbox → reconnect, not a duplicate
    const row = await prisma.emailConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(row.refreshTokenEnc).toMatch(/^v1\./);
    expect(row.refreshTokenEnc).not.toContain("refresh-1");

    box.add("m1", `Rs.645.00 has been debited from account **4821 to VPA swiggy@icici SWIGGY on ${ddmmyy(day(0))}.`);
    await syncEmailConnection(userId, connId, {}, meta);
    await disconnectEmail(userId, connId, { deleteData: true }, meta);
    expect(box.revoked).toEqual(["refresh-1"]);
    expect(await prisma.emailConnection.count()).toBe(0);
    expect(await prisma.emailMessage.count()).toBe(0);
    expect(await prisma.transaction.count({ where: { userId, deletedAt: null } })).toBe(1); // ledger keeps it
    await expect(syncEmailConnection(other, connId, {}, meta)).rejects.toMatchObject({ status: 404 });
  });
});
