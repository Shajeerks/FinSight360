import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { createLinkToken, verifyLinkToken } from "@/lib/auth/link-token";
import { getAuthMethods, oauthSignInDecision, unlinkProvider } from "@/services/auth-methods.service";
import { deleteImportTemplate, getAppSettings, getConnectedAccounts, listImportTemplates, renameImportTemplate, savePreferences } from "@/services/settings.service";
import { buildFullExport, fullExportToXlsx } from "@/services/export.service";
import { createBankAccount } from "@/services/account.service";
import { createTransaction } from "@/services/transaction.service";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { meta, resetDatabase } from "./helpers";

describe("Settings: authentication methods, templates, preferences, export (integration)", () => {
  let userId: string;
  const env = { ...process.env };

  beforeEach(async () => {
    await resetDatabase();
    userId = (await prisma.user.create({ data: { email: "me@example.com", name: "Me", passwordHash: "$2a$12$abcdefghijklmnopqrstuuSECRETHASHVALUE0123456789abcdef" } })).id;
    await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));
  });
  afterEach(() => {
    process.env = { ...env };
  });
  afterAll(() => prisma.$disconnect());

  // ───────────── sign-in decisions ─────────────

  it("OAuth sign-in: returning users, linking from Settings, email matches and closed sign-ups", async () => {
    await prisma.account.create({ data: { userId, type: "oidc", provider: "google", providerAccountId: "g-1" } });
    const base = { linkingUserId: null };
    // returning identity
    expect(await oauthSignInDecision({ ...base, provider: "google", providerAccountId: "g-1", email: "whatever@x.com" })).toBe(true);
    // Google with the same (verified) email links by email
    expect(await oauthSignInDecision({ ...base, provider: "google", providerAccountId: "g-2", email: "ME@example.com" })).toBe(true);
    // Microsoft with the same email must be added from Settings
    expect(await oauthSignInDecision({ ...base, provider: "microsoft-entra-id", providerAccountId: "m-1", email: "me@example.com" })).toBe("LinkFromSettings");
    // ...which works with a link token
    expect(await oauthSignInDecision({ provider: "microsoft-entra-id", providerAccountId: "m-1", email: "me@example.com", linkingUserId: userId })).toBe(true);
    // brand-new account: depends on ALLOW_REGISTRATION
    process.env.ALLOW_REGISTRATION = "false";
    expect(await oauthSignInDecision({ ...base, provider: "google", providerAccountId: "g-9", email: "stranger@example.com" })).toBe("RegistrationClosed");
    expect(await oauthSignInDecision({ ...base, provider: "microsoft-entra-id", providerAccountId: "m-9", email: null })).toBe("RegistrationClosed");
    process.env.ALLOW_REGISTRATION = "true";
    expect(await oauthSignInDecision({ ...base, provider: "google", providerAccountId: "g-9", email: "stranger@example.com" })).toBe(true);
  });

  it("link tokens can't be forged, reused for another provider, or used after they expire", () => {
    const t = createLinkToken(userId, "microsoft-entra-id");
    expect(verifyLinkToken(t, "microsoft-entra-id")).toBe(userId);
    expect(verifyLinkToken(t, "google")).toBeNull();
    expect(verifyLinkToken(t.replace(userId, "someone-else"), "microsoft-entra-id")).toBeNull();
    expect(verifyLinkToken(`${t.slice(0, -2)}xx`, "microsoft-entra-id")).toBeNull();
    expect(verifyLinkToken(createLinkToken(userId, "google", Date.now() - 11 * 60_000), "google")).toBeNull();
    expect(verifyLinkToken(undefined, "google")).toBeNull();
    expect(verifyLinkToken("a.b.c", "google")).toBeNull();
  });

  it("removing a sign-in method: never the last one; recorded and notified", async () => {
    process.env.GOOGLE_CLIENT_ID = "x";
    process.env.GOOGLE_CLIENT_SECRET = "y";
    await prisma.account.create({ data: { userId, type: "oidc", provider: "google", providerAccountId: "g-1" } });
    let m = await getAuthMethods(userId);
    expect(m.hasPassword).toBe(true);
    expect(m.providers.find((p) => p.id === "google")).toMatchObject({ linked: true, configured: true });
    expect(m.providers.find((p) => p.id === "microsoft-entra-id")).toMatchObject({ linked: false });

    // Google-only account (no password) can't remove its only method
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    await expect(unlinkProvider(userId, "google", meta)).rejects.toMatchObject({ code: "LAST_METHOD" });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: "$2a$12$x" } });
    await unlinkProvider(userId, "google", meta);
    m = await getAuthMethods(userId);
    expect(m.providers.find((p) => p.id === "google")?.linked).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId, action: "auth.method_removed" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId, type: "SECURITY" } })).toBe(1);
    await expect(unlinkProvider(userId, "google", meta)).rejects.toMatchObject({ code: "NOT_LINKED" });
    await expect(unlinkProvider(userId, "github", meta)).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER" });
  });

  // ───────────── import templates ─────────────

  it("import templates: rename (no clashes), delete keeps past imports, other users can't touch them", async () => {
    const a = await prisma.importMappingTemplate.create({ data: { userId, name: "HDFC CSV", fileType: "CSV", columnMapping: { fields: { transactionDate: 0, description: 1, debit: 3 }, positiveIs: "CREDIT" } } });
    await prisma.importMappingTemplate.create({ data: { userId, name: "SBI XLSX", fileType: "XLSX", columnMapping: { fields: {} } } });
    const imp = await prisma.transactionImport.create({ data: { userId, sourceType: "CSV", fileName: "x.csv", mappingTemplateId: a.id } });

    const list = await listImportTemplates(userId);
    const listed = list.find((t) => t.id === a.id)!;
    expect(listed.uses).toBe(1);
    expect([...listed.mappedColumns].sort()).toEqual(["debit", "description", "transactionDate"]);

    await expect(renameImportTemplate(userId, a.id, { name: "SBI XLSX" }, meta)).rejects.toMatchObject({ code: "TEMPLATE_EXISTS" });
    await renameImportTemplate(userId, a.id, { name: "HDFC savings CSV" }, meta);
    expect((await prisma.importMappingTemplate.findUniqueOrThrow({ where: { id: a.id } })).name).toBe("HDFC savings CSV");

    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    await expect(deleteImportTemplate(other, a.id, meta)).rejects.toMatchObject({ status: 404 });
    await expect(renameImportTemplate(other, a.id, { name: "Mine now" }, meta)).rejects.toMatchObject({ status: 404 });

    await deleteImportTemplate(userId, a.id, meta);
    expect(await prisma.importMappingTemplate.count({ where: { id: a.id } })).toBe(0);
    const after = await prisma.transactionImport.findUniqueOrThrow({ where: { id: imp.id } });
    expect(after.mappingTemplateId).toBeNull();
    expect(after.status).toBe(imp.status);
  });

  // ───────────── preferences & connections ─────────────

  it("application preferences: saved to the profile, validated", async () => {
    await savePreferences(userId, { currency: "INR", timezone: "Asia/Dubai", cardUtilizationAlertPct: "45" }, meta);
    const s = await getAppSettings(userId);
    expect(s.preferences).toEqual({ currency: "INR", timezone: "Asia/Dubai", cardUtilizationAlertPct: 45 });
    await expect(savePreferences(userId, { currency: "USD", timezone: "Asia/Dubai", cardUtilizationAlertPct: 45 }, meta)).rejects.toBeTruthy();
    await expect(savePreferences(userId, { currency: "INR", timezone: "Mars/Base", cardUtilizationAlertPct: 45 }, meta)).rejects.toBeTruthy();
    await expect(savePreferences(userId, { currency: "INR", timezone: "UTC", cardUtilizationAlertPct: 0 }, meta)).rejects.toBeTruthy();
    process.env.ALLOW_REGISTRATION = "false";
    expect((await getAppSettings(userId)).instance.registrationOpen).toBe(false);
  });

  it("connected accounts lists investment and mailbox connections without tokens", async () => {
    const inv = await prisma.investmentAccount.create({ data: { userId, name: "Groww stocks", providerName: "Groww", providerType: "GROWW" } });
    await prisma.growwConnection.create({ data: { userId, investmentAccountId: inv.id, method: "FILE_IMPORT" } });
    await prisma.emailConnection.create({ data: { userId, provider: "GMAIL", emailAddress: "me@gmail.com", accessTokenEnc: "SECRET-ACCESS", refreshTokenEnc: "SECRET-REFRESH" } });
    const c = await getConnectedAccounts(userId);
    expect(c.investments[0]).toMatchObject({ name: "Groww stocks", groww: { method: "FILE_IMPORT", status: "ACTIVE" } });
    expect(c.mailboxes[0]).toMatchObject({ emailAddress: "me@gmail.com", provider: "GMAIL" });
    expect(JSON.stringify(c)).not.toContain("SECRET");
  });

  // ───────────── data export ─────────────

  it("data export: everything of yours, nothing secret, nobody else's", async () => {
    const bank = await createBankAccount(userId, { bankName: "HDFC", nickname: "Salary", accountType: "SALARY", currentBalance: "1000" }, meta);
    await createTransaction(userId, { kind: "EXPENSE", transactionDate: "2026-10-01", amount: "250", account: `bank:${bank.id}`, description: "=HYPERLINK(\"http://evil\")" }, meta);
    await prisma.emailConnection.create({ data: { userId, provider: "GMAIL", emailAddress: "me@gmail.com", accessTokenEnc: "SECRET-ACCESS", refreshTokenEnc: "SECRET-REFRESH" } });
    await prisma.account.create({ data: { userId, type: "oidc", provider: "google", providerAccountId: "g-1", access_token: "SECRET-OAUTH", refresh_token: "SECRET-OAUTH-R" } });
    const other = (await prisma.user.create({ data: { email: "other@example.com" } })).id;
    const ob = await createBankAccount(other, { bankName: "SBI", nickname: "NotMine", accountType: "SAVINGS", currentBalance: "5" }, meta);
    await createTransaction(other, { kind: "EXPENSE", transactionDate: "2026-10-01", amount: "99", account: `bank:${ob.id}`, description: "OTHER USER" }, meta);

    const data = await buildFullExport(userId);
    expect(data.user.email).toBe("me@example.com");
    expect(data.sheets["Bank accounts"]).toHaveLength(1);
    expect(data.sheets.Transactions).toHaveLength(1);
    expect(data.sheets.Transactions[0]).toMatchObject({ amount: 250, bankAccount: "Salary" });
    const json = JSON.stringify(data);
    for (const secret of ["SECRET", "SECRETHASH", "passwordHash", "OTHER USER", "NotMine"]) expect(json).not.toContain(secret);

    const xlsx = await fullExportToXlsx(data);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ArrayBuffer);
    expect(wb.getWorksheet("About")).toBeTruthy();
    const tx = wb.getWorksheet("Transactions")!;
    const header = (tx.getRow(1).values as unknown[]).slice(1);
    const descCol = header.indexOf("description") + 1;
    expect(String(tx.getRow(2).getCell(descCol).value).startsWith("'=")).toBe(true); // formula neutralised
  });
});
