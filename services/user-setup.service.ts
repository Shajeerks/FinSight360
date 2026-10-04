import type { Prisma } from "@prisma/client";
import { NotificationChannel, NotificationType } from "@prisma/client";
import { DEFAULT_CATEGORIZATION_RULES } from "@/lib/categories/defaults";

/**
 * Creates per-user defaults: profile (INR, Asia/Kolkata), notification
 * preferences and starter categorization rules mapped to system categories.
 * Idempotent — safe to call more than once.
 */
export async function seedDefaultsForUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.userProfile.upsert({
    where: { userId },
    update: {},
    create: { userId, currency: "INR", timezone: "Asia/Kolkata", locale: "en-IN" },
  });

  const prefs: { type: NotificationType; channel: NotificationChannel; leadDays: number }[] = [
    { type: NotificationType.CARD_DUE, channel: NotificationChannel.IN_APP, leadDays: 5 },
    { type: NotificationType.EMI_DUE, channel: NotificationChannel.IN_APP, leadDays: 3 },
    { type: NotificationType.REMINDER, channel: NotificationChannel.IN_APP, leadDays: 3 },
    { type: NotificationType.UTILIZATION_ALERT, channel: NotificationChannel.IN_APP, leadDays: 0 },
    { type: NotificationType.SECURITY, channel: NotificationChannel.IN_APP, leadDays: 0 },
  ];
  await tx.notificationPreference.createMany({
    data: prefs.map((p) => ({ userId, ...p })),
    skipDuplicates: true,
  });

  const existingRules = await tx.categorizationRule.count({ where: { userId } });
  if (existingRules > 0) return;

  const systemCategories = await tx.category.findMany({
    where: { userId: null, isSystem: true },
    include: { subCategories: true },
  });
  const rules: Prisma.CategorizationRuleCreateManyInput[] = [];
  DEFAULT_CATEGORIZATION_RULES.forEach((rule, idx) => {
    const category = systemCategories.find((c) => c.name === rule.category && c.kind === rule.kind);
    if (!category) return;
    const sub = rule.subCategory ? category.subCategories.find((s) => s.name === rule.subCategory) : undefined;
    rules.push({
      userId,
      name: `${rule.pattern} → ${rule.category}${rule.subCategory ? ` / ${rule.subCategory}` : ""}`,
      matchType: rule.matchType,
      pattern: rule.pattern,
      categoryId: category.id,
      subCategoryId: sub?.id,
      priority: 100 + idx,
    });
  });
  if (rules.length) await tx.categorizationRule.createMany({ data: rules });
}
