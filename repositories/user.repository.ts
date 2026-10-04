import "server-only";
import type { Prisma, UserTokenType } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Fields that are safe to send to the UI (never passwordHash). */
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  emailVerified: true,
  role: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findFirst({ where: { email: email.toLowerCase(), deletedAt: null } });
  },

  findById(id: string) {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  },

  findPublicById(id: string) {
    return prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...publicUserSelect, passwordHash: true, profile: true, accounts: { select: { provider: true } } },
    });
  },

  createToken(data: { userId: string; type: UserTokenType; tokenHash: string; expiresAt: Date }) {
    return prisma.userToken.create({ data });
  },

  findValidToken(tokenHash: string, type: UserTokenType, now = new Date()) {
    return prisma.userToken.findFirst({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    });
  },

  /** Invalidate outstanding tokens of a type (e.g. when a new reset link is issued). */
  expireTokens(userId: string, type: UserTokenType, now = new Date()) {
    return prisma.userToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } });
  },
};
