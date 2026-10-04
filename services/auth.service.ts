import "server-only";
import { UserTokenType, type User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, RateLimitError } from "@/lib/errors";
import { parseOrThrow } from "@/lib/api";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/security/password";
import { generateToken, sha256 } from "@/lib/security/tokens";
import { limiters } from "@/lib/security/rate-limit";
import type { RequestMeta } from "@/lib/security/request";
import { getMailer } from "@/lib/mail/mailer";
import { logger } from "@/lib/logger";
import { userRepository } from "@/repositories/user.repository";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/validators/auth";
import { seedDefaultsForUser } from "@/services/user-setup.service";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MIN = 30;
const VERIFY_TOKEN_TTL_HOURS = 48;

function appUrl() {
  return process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3010";
}

function registrationAllowed() {
  return process.env.ALLOW_REGISTRATION !== "false";
}

function emailVerificationRequired() {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

// ───────────────────────────── registration ─────────────────────────────

/** Security events always notify (never blocks the action itself). */
async function securityNotice(userId: string, title: string, body: string) {
  try {
    const { notify } = await import("@/services/notification.service");
    await notify(userId, { type: "SECURITY", title, body, link: "/settings/security" });
  } catch (error) {
    logger.error("security_notice_failed", { error });
  }
}

export async function registerUser(input: unknown, meta: RequestMeta = { ip: null, userAgent: null }) {
  if (!registrationAllowed()) throw new AppError("New sign-ups are disabled on this FinSight360 instance.", 403, "REGISTRATION_DISABLED");
  const data = parseOrThrow(registerSchema, input);

  // Per-IP when we know it, plus a global ceiling (IP headers can be forged).
  const rl = meta.ip ? await limiters.register.check(`register:${meta.ip}`) : { allowed: true, retryAfterSeconds: 0 };
  if (!rl.allowed) throw new RateLimitError(rl.retryAfterSeconds);
  const rlGlobal = await limiters.registerGlobal.check("register:all");
  if (!rlGlobal.allowed) throw new RateLimitError(rlGlobal.retryAfterSeconds);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new AppError("An account with this email already exists. Try signing in instead.", 409, "EMAIL_TAKEN", {
      email: ["An account with this email already exists"],
    });
  }

  const passwordHash = await hashPassword(data.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email: data.email, name: data.name, passwordHash, passwordChangedAt: new Date() },
    });
    await seedDefaultsForUser(tx, created.id);
    await audit({ userId: created.id, action: AuditAction.REGISTER, entityType: "User", entityId: created.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return created;
  });

  // The account exists at this point; a failed email must not fail registration.
  await sendVerificationEmail(user).catch((error) => logger.warn("auth.verification_email_failed", { userId: user.id, error }));
  return { id: user.id, email: user.email };
}

// ───────────────────────────── login ─────────────────────────────

export type AuthenticatedUser = Pick<User, "id" | "email" | "name" | "image" | "role" | "sessionVersion">;

/**
 * Verifies email/password. Returns null for any failure (generic message to the
 * user — never reveal whether the email exists). Applies rate limiting and
 * account lockout after repeated failures.
 */
export async function authenticateWithPassword(input: unknown, meta: RequestMeta): Promise<AuthenticatedUser | null> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const rl = await limiters.login.check(`login:${email}:${meta.ip ?? "unknown"}`);
  // Per-email ceiling that header spoofing can't reset.
  const rlEmail = await limiters.loginEmail.check(`login-email:${email}`);
  if (!rl.allowed || !rlEmail.allowed) {
    await audit({ action: AuditAction.LOGIN_FAILED, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: "rate_limited" } });
    return null;
  }

  const user = await userRepository.findByEmail(email);
  if (!user || !user.passwordHash || user.status !== "ACTIVE") {
    await verifyAgainstDummy(password);
    await audit({ userId: user?.id, action: AuditAction.LOGIN_FAILED, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: user ? "no_password_or_disabled" : "unknown_email" } });
    return null;
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await verifyAgainstDummy(password);
    await audit({ userId: user.id, action: AuditAction.LOGIN_FAILED, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: "locked" } });
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    // Atomic increment so parallel guesses are all counted.
    const updated = await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    const failed = updated.failedLoginCount;
    if (failed >= MAX_FAILED_LOGINS) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) } });
    }
    await audit({ userId: user.id, action: AuditAction.LOGIN_FAILED, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: "bad_password", locked: failed >= MAX_FAILED_LOGINS } });
    return null;
  }

  if (emailVerificationRequired() && !user.emailVerified) {
    await audit({ userId: user.id, action: AuditAction.LOGIN_FAILED, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: "email_unverified" } });
    return null;
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await limiters.login.reset(`login:${email}:${meta.ip ?? "unknown"}`);
  // Audit here (not in the Auth.js event) so the entry carries IP + user agent.
  await recordSuccessfulLogin(user.id, "credentials", meta);
  return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role, sessionVersion: user.sessionVersion };
}

/**
 * Before linking an OAuth identity to an existing user with the same email:
 * if that user never verified the email, a password set by whoever registered
 * it can't be trusted — remove it and revoke every session.
 */
export async function secureUnverifiedAccountForOAuth(email: string) {
  const existing = await prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  if (!existing || existing.emailVerified || !existing.passwordHash) return;
  await prisma.user.update({
    where: { id: existing.id },
    data: { passwordHash: null, sessionVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
  });
  await audit({ userId: existing.id, action: AuditAction.SESSIONS_REVOKED, entityType: "User", entityId: existing.id, metadata: { reason: "oauth_claimed_unverified_account" } });
}

/** Called after any successful sign-in (password or OAuth). */
export async function recordSuccessfulLogin(userId: string, provider: string, meta: RequestMeta) {
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }).catch(() => undefined);
  await audit({ userId, action: AuditAction.LOGIN, entityType: "User", entityId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider } });
}

// ───────────────────────────── email verification ─────────────────────────────

async function issueToken(userId: string, type: UserTokenType, ttlMs: number) {
  const token = generateToken();
  await userRepository.expireTokens(userId, type);
  await userRepository.createToken({ userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name" | "emailVerified">) {
  if (user.emailVerified) return;
  const rl = await limiters.email.check(`verify:${user.email}`);
  if (!rl.allowed) throw new RateLimitError(rl.retryAfterSeconds);
  const token = await issueToken(user.id, UserTokenType.EMAIL_VERIFICATION, VERIFY_TOKEN_TTL_HOURS * 3_600_000);
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await getMailer().send({
    to: user.email,
    subject: "Verify your FinSight360 email",
    text: `Hi ${user.name ?? ""},\n\nConfirm your email address by opening this link (valid for ${VERIFY_TOKEN_TTL_HOURS} hours):\n${link}\n\nIf you did not create a FinSight360 account, ignore this email.`,
  });
}

export async function verifyEmail(token: string, meta: RequestMeta = { ip: null, userAgent: null }) {
  if (!token || token.length < 20 || token.length > 200) throw new AppError("This verification link is invalid or has expired.", 400, "INVALID_TOKEN");
  const record = await userRepository.findValidToken(sha256(token), UserTokenType.EMAIL_VERIFICATION);
  if (!record) throw new AppError("This verification link is invalid or has expired.", 400, "INVALID_TOKEN");
  await prisma.$transaction([
    prisma.userToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: record.user.emailVerified ?? new Date() } }),
  ]);
  await audit({ userId: record.userId, action: AuditAction.EMAIL_VERIFIED, entityType: "User", entityId: record.userId, ip: meta.ip, userAgent: meta.userAgent });
  return { email: record.user.email };
}

// ───────────────────────────── password reset ─────────────────────────────

/** Always resolves the same way whether or not the email exists (no user enumeration). */
export async function requestPasswordReset(input: unknown, meta: RequestMeta = { ip: null, userAgent: null }) {
  const { email } = parseOrThrow(forgotPasswordSchema, input);
  const rl = await limiters.email.check(`reset:${email}`);
  if (!rl.allowed) return;
  const user = await userRepository.findByEmail(email);
  if (!user || user.status !== "ACTIVE") return;

  const token = await issueToken(user.id, UserTokenType.PASSWORD_RESET, RESET_TOKEN_TTL_MIN * 60_000);
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await getMailer().send({
    to: user.email,
    subject: "Reset your FinSight360 password",
    text: `Someone (hopefully you) asked to reset your FinSight360 password.\n\nOpen this link within ${RESET_TOKEN_TTL_MIN} minutes to choose a new password:\n${link}\n\nIf you didn't ask for this, you can ignore this email — your password won't change.`,
  });
  await audit({ userId: user.id, action: AuditAction.PASSWORD_RESET_REQUESTED, entityType: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent });
}

export async function resetPassword(input: unknown, meta: RequestMeta = { ip: null, userAgent: null }) {
  const data = parseOrThrow(resetPasswordSchema, input);
  const record = await userRepository.findValidToken(sha256(data.token), UserTokenType.PASSWORD_RESET);
  if (!record) throw new AppError("This reset link is invalid or has expired. Please request a new one.", 400, "INVALID_TOKEN");

  const passwordHash = await hashPassword(data.password);
  const now = new Date();
  await prisma.$transaction([
    prisma.userToken.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        failedLoginCount: 0,
        lockedUntil: null,
        // Clicking the emailed link proves mailbox ownership.
        emailVerified: record.user.emailVerified ?? now,
        // Sign out every existing session.
        sessionVersion: { increment: 1 },
      },
    }),
  ]);
  await audit({ userId: record.userId, action: AuditAction.PASSWORD_RESET, entityType: "User", entityId: record.userId, ip: meta.ip, userAgent: meta.userAgent });
  await securityNotice(record.userId, "Your password was reset", "Your FinSight360 password was reset and all devices were signed out. If this wasn't you, reset it again now.");
}

// ───────────────────────────── signed-in account security ─────────────────────────────

export async function changePassword(userId: string, input: unknown, meta: RequestMeta = { ip: null, userAgent: null }) {
  const data = parseOrThrow(changePasswordSchema, input);
  const user = await userRepository.findById(userId);
  if (!user) throw new AppError("Account not found.", 404, "NOT_FOUND");

  if (user.passwordHash) {
    const ok = data.currentPassword ? await verifyPassword(data.currentPassword, user.passwordHash) : false;
    if (!ok) throw new AppError("Current password is incorrect.", 400, "BAD_PASSWORD", { currentPassword: ["Current password is incorrect"] });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(data.newPassword), passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  await audit({ userId, action: AuditAction.PASSWORD_CHANGED, entityType: "User", entityId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: { hadPassword: Boolean(user.passwordHash) } });
  await securityNotice(userId, "Your password was changed", "Your FinSight360 password was changed. If this wasn't you, reset your password now.");
}

/** Invalidates every session (all devices) by bumping sessionVersion. */
export async function revokeAllSessions(userId: string, meta: RequestMeta = { ip: null, userAgent: null }) {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  await audit({ userId, action: AuditAction.SESSIONS_REVOKED, entityType: "User", entityId: userId, ip: meta.ip, userAgent: meta.userAgent });
  await securityNotice(userId, "Signed out everywhere", "All devices were signed out of FinSight360.");
}

/** Used by the session callback to confirm a JWT is still valid. */
export async function getSessionState(userId: string) {
  return prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, status: true, sessionVersion: true, role: true, name: true, email: true, image: true },
  });
}
