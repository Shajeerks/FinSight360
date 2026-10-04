import "server-only";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { profileSchema } from "@/validators/profile";

export async function getProfile(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      emailVerified: true,
      createdAt: true,
      lastLoginAt: true,
      passwordHash: true,
      profile: true,
      accounts: { select: { provider: true } },
    },
  });
  if (!user) throw new NotFoundError("Account not found.");
  const { passwordHash, ...rest } = user;
  return {
    ...rest,
    hasPassword: Boolean(passwordHash),
    providers: user.accounts.map((a) => a.provider),
    profile: {
      displayName: user.profile?.displayName ?? "",
      phone: user.profile?.phone ?? "",
      currency: user.profile?.currency ?? "INR",
      timezone: user.profile?.timezone ?? "Asia/Kolkata",
      cardUtilizationAlertPct: user.profile?.cardUtilizationAlertPct.toNumber() ?? 30,
    },
  };
}

export async function updateProfile(userId: string, input: unknown, meta: RequestMeta = { ip: null, userAgent: null }) {
  const data = parseOrThrow(profileSchema, input);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { name: data.name } });
    await tx.userProfile.upsert({
      where: { userId },
      update: {
        displayName: data.displayName || null,
        phone: data.phone || null,
        currency: data.currency,
        timezone: data.timezone,
        cardUtilizationAlertPct: data.cardUtilizationAlertPct,
      },
      create: {
        userId,
        displayName: data.displayName || null,
        phone: data.phone || null,
        currency: data.currency,
        timezone: data.timezone,
        cardUtilizationAlertPct: data.cardUtilizationAlertPct,
      },
    });
    await audit(
      {
        userId,
        action: AuditAction.PROFILE_UPDATED,
        entityType: "UserProfile",
        entityId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        metadata: { fields: ["name", "displayName", "phone", "currency", "timezone", "cardUtilizationAlertPct"] },
      },
      tx,
    );
  });
}

export async function getRecentAuditLog(userId: string, take = 50) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, entityType: true, ipAddress: true, userAgent: true, createdAt: true },
  });
}
