import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { countableWhere } from "@/lib/transactions/countable";
import { monthRange, type YearMonth } from "@/lib/dates";
import { Decimal, roundMoney, toDecimal } from "@/lib/money";
import { assertCategory } from "@/services/category.service";
import { optionalId, positiveMoney } from "@/validators/common";

const NO_META: RequestMeta = { ip: null, userAgent: null };

export const budgetSchema = z.object({
  name: z.string().trim().max(60).optional().nullable(),
  categoryId: optionalId,
  subCategoryId: optionalId,
  period: z.enum(["MONTHLY", "YEARLY"]).default("MONTHLY"),
  amount: positiveMoney,
  alertThresholdPct: z.coerce.number().int().min(10, "10–100").max(100, "10–100").default(80),
});

export async function saveBudget(userId: string, id: string | null, input: unknown, meta: RequestMeta = NO_META) {
  assertIds(id);
  const d = parseOrThrow(budgetSchema, input);
  const cat = d.categoryId ? await assertCategory(prisma, userId, d.categoryId, d.subCategoryId) : null;
  if (cat && cat.kind !== "EXPENSE") throw new AppError("Budgets are for spending categories.", 400, "INVALID_CATEGORY", { categoryId: ["Choose an expense category"] });
  const dup = await prisma.budget.findFirst({ where: { userId, isActive: true, categoryId: d.categoryId, subCategoryId: d.subCategoryId, period: d.period, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw new AppError("There's already a budget for this category.", 409, "BUDGET_EXISTS", { categoryId: ["Already budgeted — edit that budget instead"] });
  const data = {
    name: d.name || cat?.name || "Total spending",
    categoryId: d.categoryId,
    subCategoryId: d.subCategoryId,
    period: d.period,
    amount: toDecimal(d.amount),
    alertThresholdPct: d.alertThresholdPct,
  };
  let b;
  if (id) {
    const existing = await prisma.budget.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundError("Budget not found.");
    b = await prisma.budget.update({ where: { id }, data });
  } else {
    const now = new Date();
    b = await prisma.budget.create({ data: { userId, ...data, startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } });
  }
  await audit({ userId, action: id ? "budget.updated" : "budget.created", entityType: "Budget", entityId: b.id, ip: meta.ip, userAgent: meta.userAgent });
  return b;
}

export async function deleteBudget(userId: string, id: string, meta: RequestMeta = NO_META) {
  assertIds(id);
  const b = await prisma.budget.findFirst({ where: { id, userId } });
  if (!b) throw new NotFoundError("Budget not found.");
  await prisma.budget.update({ where: { id }, data: { isActive: false, endDate: new Date() } });
  await audit({ userId, action: "budget.deleted", entityType: "Budget", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

export type BudgetStatus = "OK" | "WARNING" | "OVER";

/** Net spending (purchases − refunds) for each active budget in the month (or that year for yearly budgets). */
export async function budgetProgress(userId: string, ym: YearMonth) {
  const budgets = await prisma.budget.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
    include: { category: { select: { name: true, color: true, deletedAt: true } }, subCategory: { select: { name: true } } },
  });
  const out = [];
  for (const b of budgets) {
    const range = b.period === "YEARLY" ? { start: new Date(Date.UTC(ym.year, 0, 1)), end: new Date(Date.UTC(ym.year + 1, 0, 1)) } : monthRange(ym);
    const where = {
      transactionDate: { gte: range.start, lt: range.end },
      ...(b.categoryId ? { categoryId: b.categoryId } : {}),
      ...(b.subCategoryId ? { subCategoryId: b.subCategoryId } : {}),
    };
    const [spent, refunds] = await Promise.all([
      prisma.transaction.aggregate({ where: countableWhere(userId, { ...where, direction: "DEBIT", transactionType: { in: ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER"] } }), _sum: { amount: true } }),
      prisma.transaction.aggregate({ where: countableWhere(userId, { ...where, direction: "CREDIT", transactionType: { in: ["REFUND", "REVERSAL"] } }), _sum: { amount: true } }),
    ]);
    const net = roundMoney(Decimal.max(toDecimal(spent._sum.amount ?? 0).minus(toDecimal(refunds._sum.amount ?? 0)), 0));
    const usedPct = b.amount.isZero() ? 0 : net.dividedBy(b.amount).times(100).toDecimalPlaces(1).toNumber();
    const status: BudgetStatus = usedPct >= 100 ? "OVER" : usedPct >= b.alertThresholdPct.toNumber() ? "WARNING" : "OK";
    out.push({
      id: b.id,
      name: b.subCategory ? `${b.category?.name} › ${b.subCategory.name}` : b.name,
      categoryId: b.categoryId,
      subCategoryId: b.subCategoryId,
      color: b.category?.color ?? null,
      period: b.period,
      amount: b.amount,
      alertThresholdPct: b.alertThresholdPct.toNumber(),
      spent: net,
      remaining: roundMoney(b.amount.minus(net)),
      usedPct,
      status,
    });
  }
  return out;
}

export type BudgetProgress = Awaited<ReturnType<typeof budgetProgress>>[number];
