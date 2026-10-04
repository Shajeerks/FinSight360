import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export const AuditAction = {
  LOGIN: "auth.login",
  LOGIN_FAILED: "auth.login_failed",
  LOGOUT: "auth.logout",
  REGISTER: "auth.register",
  EMAIL_VERIFIED: "auth.email_verified",
  PASSWORD_RESET_REQUESTED: "auth.password_reset_requested",
  PASSWORD_RESET: "auth.password_reset",
  PASSWORD_CHANGED: "auth.password_changed",
  SESSIONS_REVOKED: "auth.sessions_revoked",
  PROFILE_UPDATED: "settings.profile_updated",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CREATED: "account.created",
  ACCOUNT_UPDATED: "account.updated",
  ACCOUNT_DELETED: "account.deleted",
  CARD_CREATED: "credit_card.created",
  CARD_UPDATED: "credit_card.updated",
  CARD_DELETED: "credit_card.deleted",
  TRANSACTION_CREATED: "transaction.created",
  TRANSACTION_UPDATED: "transaction.updated",
  TRANSACTION_DELETED: "transaction.deleted",
  CATEGORY_CREATED: "category.created",
  CATEGORY_UPDATED: "category.updated",
  CATEGORY_DELETED: "category.deleted",
  RULE_CREATED: "rule.created",
  RULE_UPDATED: "rule.updated",
  RULE_DELETED: "rule.deleted",
  RULES_APPLIED: "rule.applied_to_existing",
  LOAN_CREATED: "loan.created",
  LOAN_UPDATED: "loan.updated",
  LOAN_DELETED: "loan.deleted",
  LOAN_PAYMENT_RECORDED: "loan.payment_recorded",
  LOAN_PAYMENT_DELETED: "loan.payment_deleted",
  LOAN_RATE_REVISED: "loan.rate_revised",
  IMPORT_UPLOADED: "import.uploaded",
  IMPORT_COMPLETED: "import.completed",
  IMPORT_UNDONE: "import.undone",
  DUPLICATE_RESOLVED: "duplicate.resolved",
  EMAIL_CONNECTED: "email.connected",
  EMAIL_DISCONNECTED: "email.disconnected",
  EMAIL_SYNCED: "email.synced",
  EMAIL_CANDIDATE_RESOLVED: "email.candidate_resolved",
  INVESTMENT_ACCOUNT_CREATED: "investment.account_created",
  INVESTMENT_ACCOUNT_UPDATED: "investment.account_updated",
  INVESTMENT_ACCOUNT_DELETED: "investment.account_deleted",
  INVESTMENT_HOLDING_SAVED: "investment.holding_saved",
  INVESTMENT_HOLDING_DELETED: "investment.holding_deleted",
  INVESTMENT_TXN_CREATED: "investment.transaction_created",
  INVESTMENT_TXN_DELETED: "investment.transaction_deleted",
  INVESTMENT_IMPORTED: "investment.imported",
  INVESTMENT_PRICES_UPDATED: "investment.prices_updated",
  REVIEW_RESOLVED: "review.resolved",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction] | (string & {});

export type AuditInput = {
  userId?: string | null;
  action: AuditActionValue;
  entityType?: string;
  entityId?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Non-sensitive context only — never passwords, tokens or card numbers. */
  metadata?: Prisma.InputJsonValue;
};

/** Writes an audit entry. Never throws — auditing must not break user flows. */
export async function audit(input: AuditInput, db: Pick<typeof prisma, "auditLog"> = prisma): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ipAddress: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    logger.error("audit.write_failed", { action: input.action, error });
  }
}
