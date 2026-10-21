import "server-only";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { toDecimal } from "@/lib/money";
import { isGoogleAuthEnabled, isMicrosoftAuthEnabled, isRegistrationAllowed } from "@/lib/env";
import { preferencesSchema, templateRenameSchema } from "@/validators/settings";

const NO_META: RequestMeta = { ip: null, userAgent: null };

// ───────────────────────────── connected accounts ─────────────────────────────

/** Groww (statement-file) connections and mailbox connections, with their last activity. */
export async function getConnectedAccounts(userId: string) {
  const [groww, mail] = await Promise.all([
    prisma.investmentAccount.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, name: true, providerName: true, providerType: true, accountType: true,
        _count: { select: { holdings: { where: { deletedAt: null } } } },
        groww: { select: { method: true, status: true, lastSyncAt: true, lastError: true, syncJobs: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, fileName: true, startedAt: true, holdingsUpserted: true, transactionsImported: true } } } },
      },
    }),
    prisma.emailConnection.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, provider: true, emailAddress: true, status: true, lastSyncAt: true, lastError: true, createdAt: true },
    }),
  ]);
  return { investments: groww, mailboxes: mail };
}

// ───────────────────────────── import templates ─────────────────────────────

export async function listImportTemplates(userId: string) {
  const rows = await prisma.importMappingTemplate.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, institution: true, fileType: true, amountMode: true, dateFormat: true, headerRow: true, columnMapping: true, createdAt: true, updatedAt: true, _count: { select: { imports: true } } },
  });
  return rows.map((t) => {
    const m = (t.columnMapping ?? {}) as { fields?: Record<string, unknown>; headers?: string[] };
    const fields = m.fields && typeof m.fields === "object" ? m.fields : (t.columnMapping as Record<string, unknown>);
    return { ...t, mappedColumns: Object.keys(fields ?? {}).filter((k) => k !== "positiveIs" && k !== "headers"), uses: t._count.imports };
  });
}

export async function renameImportTemplate(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  assertIds(id);
  const { name } = parseOrThrow(templateRenameSchema, input);
  const t = await prisma.importMappingTemplate.findFirst({ where: { id, userId } });
  if (!t) throw new NotFoundError("Template not found.");
  const clash = await prisma.importMappingTemplate.findFirst({ where: { userId, name, id: { not: id } }, select: { id: true } });
  if (clash) throw new AppError("You already have a template with this name.", 409, "TEMPLATE_EXISTS", { name: ["Choose another name"] });
  await prisma.importMappingTemplate.update({ where: { id }, data: { name } });
  await audit({ userId, action: AuditAction.IMPORT_TEMPLATE_UPDATED, entityType: "ImportMappingTemplate", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { from: t.name, to: name } });
}

/** Past imports keep their transactions; only their link to the template is cleared. */
export async function deleteImportTemplate(userId: string, id: string, meta: RequestMeta = NO_META) {
  assertIds(id);
  const t = await prisma.importMappingTemplate.findFirst({ where: { id, userId } });
  if (!t) throw new NotFoundError("Template not found.");
  await prisma.$transaction([
    prisma.transactionImport.updateMany({ where: { userId, mappingTemplateId: id }, data: { mappingTemplateId: null } }),
    prisma.importMappingTemplate.delete({ where: { id } }),
  ]);
  await audit({ userId, action: AuditAction.IMPORT_TEMPLATE_DELETED, entityType: "ImportMappingTemplate", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { name: t.name } });
}

// ───────────────────────────── application preferences ─────────────────────────────

export async function getAppSettings(userId: string) {
  const [profile, jobs] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.systemSetting.findUnique({ where: { key: "jobs.daily.lastRun" } }),
  ]);
  const lastDaily = jobs?.value && typeof jobs.value === "object" && "at" in (jobs.value as object) ? String((jobs.value as { at: unknown }).at) : typeof jobs?.value === "string" ? jobs.value : null;
  return {
    preferences: {
      currency: "INR" as const, // only INR is supported today
      timezone: profile?.timezone ?? "Asia/Kolkata",
      cardUtilizationAlertPct: Number(profile?.cardUtilizationAlertPct ?? 30),
    },
    instance: {
      registrationOpen: isRegistrationAllowed(),
      emailDelivery: process.env.EMAIL_TRANSPORT === "smtp" && Boolean(process.env.SMTP_HOST) ? "smtp" : "console",
      googleSignIn: isGoogleAuthEnabled(),
      microsoftSignIn: isMicrosoftAuthEnabled(),
      gmailImport: Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
      outlookImport: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      emailSyncMinutes: Number(process.env.EMAIL_SYNC_INTERVAL_MINUTES ?? 60),
      lastDailyJobs: lastDaily,
    },
  };
}

export async function savePreferences(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(preferencesSchema, input);
  await prisma.userProfile.upsert({
    where: { userId },
    update: { currency: d.currency, timezone: d.timezone, cardUtilizationAlertPct: toDecimal(d.cardUtilizationAlertPct) },
    create: { userId, currency: d.currency, timezone: d.timezone, cardUtilizationAlertPct: toDecimal(d.cardUtilizationAlertPct) },
  });
  await audit({ userId, action: AuditAction.SETTINGS_CHANGED, entityType: "UserProfile", entityId: userId, ip: meta.ip, userAgent: meta.userAgent, metadata: d });
}
