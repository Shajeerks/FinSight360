import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { allowedKindsFor, categorize, type RuleForMatching } from "@/lib/categorization/engine";
import { roundMoney } from "@/lib/money";
import { countableWhere } from "@/lib/transactions/countable";
import { ruleSchema } from "@/validators/transactions";
import { assertCategory } from "@/services/category.service";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Db = Prisma.TransactionClient | typeof prisma;

export async function listRules(userId: string) {
  return prisma.categorizationRule.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { priority: "asc" }, { createdAt: "asc" }],
    include: { category: { select: { name: true, kind: true, color: true } }, subCategory: { select: { name: true } } },
  });
}

/** Active rules in the shape the pure engine expects. */
export async function loadRulesForMatching(db: Db, userId: string): Promise<RuleForMatching[]> {
  const rules = await db.categorizationRule.findMany({
    where: { userId, isActive: true, category: { deletedAt: null } },
    include: { category: { select: { kind: true } } },
  });
  return rules.map((r) => ({
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    amountMin: r.amountMin,
    amountMax: r.amountMax,
    direction: r.direction,
    categoryId: r.categoryId,
    subCategoryId: r.subCategoryId,
    categoryKind: r.category.kind,
    priority: r.priority,
    isActive: r.isActive,
  }));
}

function ruleData(data: ReturnType<typeof ruleSchema.parse>) {
  const label = data.matchType === "AMOUNT" ? `Amount ${data.amountMin ?? "…"}–${data.amountMax ?? "…"}` : data.pattern;
  return {
    name: data.name || label || "Rule",
    matchType: data.matchType,
    pattern: data.pattern ? data.pattern.toUpperCase() : null,
    amountMin: data.amountMin ? roundMoney(data.amountMin) : null,
    amountMax: data.amountMax ? roundMoney(data.amountMax) : null,
    direction: data.direction,
    categoryId: data.categoryId,
    subCategoryId: data.subCategoryId,
    priority: data.priority,
    isActive: data.isActive,
  };
}

export async function createRule(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(ruleSchema, input);
  await assertCategory(prisma, userId, data.categoryId, data.subCategoryId);
  const rule = await prisma.categorizationRule.create({ data: { userId, ...ruleData(data) } });
  await audit({ userId, action: AuditAction.RULE_CREATED, entityType: "CategorizationRule", entityId: rule.id, ip: meta.ip, userAgent: meta.userAgent });
  return rule;
}

async function ownRule(userId: string, id: string) {
  const r = await prisma.categorizationRule.findFirst({ where: { id, userId } });
  if (!r) throw new NotFoundError("Rule not found.");
  return r;
}

export async function updateRule(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  await ownRule(userId, id);
  const data = parseOrThrow(ruleSchema, input);
  await assertCategory(prisma, userId, data.categoryId, data.subCategoryId);
  const rule = await prisma.categorizationRule.update({ where: { id }, data: ruleData(data) });
  await audit({ userId, action: AuditAction.RULE_UPDATED, entityType: "CategorizationRule", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return rule;
}

export async function setRuleActive(userId: string, id: string, isActive: boolean, meta: RequestMeta = NO_META) {
  await ownRule(userId, id);
  await prisma.categorizationRule.update({ where: { id }, data: { isActive } });
  await audit({ userId, action: AuditAction.RULE_UPDATED, entityType: "CategorizationRule", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { isActive } });
}

export async function deleteRule(userId: string, id: string, meta: RequestMeta = NO_META) {
  await ownRule(userId, id);
  await prisma.categorizationRule.delete({ where: { id } });
  await audit({ userId, action: AuditAction.RULE_DELETED, entityType: "CategorizationRule", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

/**
 * Run the rules over existing *uncategorized* transactions (never overrides a
 * category the user chose). Returns how many were categorized.
 */
export async function applyRulesToUncategorized(userId: string, meta: RequestMeta = NO_META) {
  const rules = await loadRulesForMatching(prisma, userId);
  const txs = await prisma.transaction.findMany({
    where: countableWhere(userId, { categoryId: null }),
    select: { id: true, description: true, merchantName: true, amount: true, direction: true, transactionType: true, merchant: { select: { defaultCategoryId: true, defaultSubCategoryId: true, defaultCategory: { select: { kind: true, deletedAt: true } } } } },
    take: 5000,
  });
  let updated = 0;
  for (const t of txs) {
    const res = categorize(
      { description: t.description, merchantName: t.merchantName, amount: t.amount, direction: t.direction, allowedKinds: allowedKindsFor(t.transactionType, t.direction) },
      rules,
      t.merchant?.defaultCategory && !t.merchant.defaultCategory.deletedAt
        ? { categoryId: t.merchant.defaultCategoryId, subCategoryId: t.merchant.defaultSubCategoryId, categoryKind: t.merchant.defaultCategory.kind }
        : null,
    );
    if (!res) continue;
    await prisma.transaction.update({ where: { id: t.id }, data: { categoryId: res.categoryId, subCategoryId: res.subCategoryId } });
    updated++;
  }
  await audit({ userId, action: AuditAction.RULES_APPLIED, entityType: "CategorizationRule", ip: meta.ip, userAgent: meta.userAgent, metadata: { updated } });
  return updated;
}
