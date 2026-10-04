import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  authenticateWithPassword,
  changePassword,
  getSessionState,
  registerUser,
  requestPasswordReset,
  resetPassword,
  revokeAllSessions,
  verifyEmail,
  MAX_FAILED_LOGINS,
} from "@/services/auth.service";
import { limiters } from "@/lib/security/rate-limit";
import { captureMail, meta, resetDatabase, seedMinimalCategories } from "./helpers";

const PASSWORD = "Sup3r-Secret-Pass";

async function register(email = "asha@example.com", m = meta) {
  return registerUser({ name: "Asha Nair", email, password: PASSWORD, confirmPassword: PASSWORD }, m);
}

describe("authentication (integration)", () => {
  let mail: ReturnType<typeof captureMail>;

  beforeAll(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedMinimalCategories();
    mail = captureMail();
    for (const l of Object.values(limiters)) await l.clear();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a user with a hashed password, profile, preferences, rules and an audit entry", async () => {
    const { id, email } = await register();
    expect(email).toBe("asha@example.com");
    const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: { profile: true, notificationPreferences: true, categorizationRules: true } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.profile?.currency).toBe("INR");
    expect(user.profile?.timezone).toBe("Asia/Kolkata");
    expect(user.notificationPreferences.length).toBeGreaterThan(0);
    expect(user.categorizationRules.some((r) => r.pattern === "SWIGGY")).toBe(true);
    expect(await prisma.auditLog.count({ where: { userId: id, action: "auth.register" } })).toBe(1);
    // a verification email was sent, token stored only as a hash
    const link = mail.lastLink("/verify-email");
    expect(link).not.toBeNull();
    const token = link!.searchParams.get("token")!;
    const stored = await prisma.userToken.findFirstOrThrow({ where: { userId: id } });
    expect(stored.tokenHash).not.toBe(token);
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    await register();
    await expect(register("ASHA@example.com", { ...meta, ip: "10.0.0.2" })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("rejects weak passwords server-side", async () => {
    await expect(registerUser({ name: "X Y", email: "x@example.com", password: "weak", confirmPassword: "weak" }, meta)).rejects.toBeInstanceOf(AppError);
  });

  it("signs in with correct credentials only", async () => {
    await register();
    const ok = await authenticateWithPassword({ email: "ASHA@example.com", password: PASSWORD }, meta);
    expect(ok?.email).toBe("asha@example.com");
    expect(await authenticateWithPassword({ email: "asha@example.com", password: "Wrong-Pass-123" }, meta)).toBeNull();
    expect(await authenticateWithPassword({ email: "nobody@example.com", password: PASSWORD }, meta)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.login_failed" } })).toBe(2);
    const login = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login" } });
    expect(login.ipAddress).toBe(meta.ip);
    expect(login.metadata).toMatchObject({ provider: "credentials" });
  });

  it(`locks the account for 15 minutes after ${MAX_FAILED_LOGINS} failed attempts`, async () => {
    const { id } = await register();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      expect(await authenticateWithPassword({ email: "asha@example.com", password: `Wrong-${i}-Pass` }, { ...meta, ip: `10.1.0.${i}` })).toBeNull();
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // even the right password fails while locked
    expect(await authenticateWithPassword({ email: "asha@example.com", password: PASSWORD }, { ...meta, ip: "10.2.0.1" })).toBeNull();
  });

  it("verifies email with a single-use token", async () => {
    const { id } = await register();
    const token = mail.lastLink("/verify-email")!.searchParams.get("token")!;
    await verifyEmail(token, meta);
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).emailVerified).not.toBeNull();
    await expect(verifyEmail(token, meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("resets a password via emailed link, revoking existing sessions", async () => {
    const { id } = await register();
    const before = await getSessionState(id);
    await requestPasswordReset({ email: "asha@example.com" }, meta);
    const token = mail.lastLink("/reset-password")!.searchParams.get("token")!;
    await resetPassword({ token, password: "Brand-New-Pass9", confirmPassword: "Brand-New-Pass9" }, meta);

    const after = await getSessionState(id);
    expect(after!.sessionVersion).toBe(before!.sessionVersion + 1);
    expect(await authenticateWithPassword({ email: "asha@example.com", password: "Brand-New-Pass9" }, { ...meta, ip: "10.3.0.1" })).not.toBeNull();
    expect(await authenticateWithPassword({ email: "asha@example.com", password: PASSWORD }, { ...meta, ip: "10.3.0.2" })).toBeNull();
    // token is single-use
    await expect(resetPassword({ token, password: "Another-Pass99", confirmPassword: "Another-Pass99" }, meta)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("does not reveal whether an email exists on password reset", async () => {
    await expect(requestPasswordReset({ email: "ghost@example.com" }, meta)).resolves.toBeUndefined();
    expect(mail.sent.filter((m) => m.subject.includes("Reset"))).toHaveLength(0);
  });

  it("changes password (requires current password) and supports sign-out-everywhere", async () => {
    const { id } = await register();
    await expect(changePassword(id, { currentPassword: "nope", newPassword: "Next-Pass-123", confirmPassword: "Next-Pass-123" })).rejects.toMatchObject({ code: "BAD_PASSWORD" });
    await changePassword(id, { currentPassword: PASSWORD, newPassword: "Next-Pass-123", confirmPassword: "Next-Pass-123" });
    const v1 = (await getSessionState(id))!.sessionVersion;
    await revokeAllSessions(id, meta);
    expect((await getSessionState(id))!.sessionVersion).toBe(v1 + 1);
    expect(await prisma.auditLog.count({ where: { userId: id, action: { in: ["auth.password_changed", "auth.sessions_revoked"] } } })).toBe(2);
  });

  it("a verified OAuth sign-in neutralises an unverified password account with the same email", async () => {
    const { secureUnverifiedAccountForOAuth } = await import("@/services/auth.service");
    const { id } = await register("victim@example.com");
    const before = await getSessionState(id);
    await secureUnverifiedAccountForOAuth("Victim@Example.com");
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.passwordHash).toBeNull();
    expect(u.sessionVersion).toBe(before!.sessionVersion + 1);
    expect(await authenticateWithPassword({ email: "victim@example.com", password: PASSWORD }, { ...meta, ip: "10.9.0.1" })).toBeNull();
  });

  it("counts parallel wrong guesses (no lockout bypass)", async () => {
    const { id } = await register("par@example.com");
    await Promise.all(Array.from({ length: MAX_FAILED_LOGINS }, (_, i) => authenticateWithPassword({ email: "par@example.com", password: `Wrong-${i}-xx` }, { ...meta, ip: `10.8.0.${i}` })));
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.lockedUntil?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });
});
