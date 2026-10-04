import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { categorySchema, subCategorySchema } from "@/validators/transactions";

const NO_META: RequestMeta = { ip: null, userAgent: null };

/** System categories + the user's own, each with visible sub-categories. */
export async function listCategories(userId: string, kind?: "EXPENSE" | "INCOME" | "TRANSFER") {
  return prisma.category.findMany({
    where: { deletedAt: null, OR: [{ userId: null }, { userId }], ...(kind ? { kind } : {}) },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: {
      subCategories: {
        where: { deletedAt: null, OR: [{ userId: null }, { userId }] },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, userId: true, isSystem: true },
      },
    },
  });
}

export type CategoryOption = Awaited<ReturnType<typeof listCategories>>[number];

/** Validates that a category (and optional sub-category) is usable by this user. */
export async function assertCategory(
  db: Pick<typeof prisma, "category" | "subCategory">,
  userId: string,
  categoryId: string | null,
  subCategoryId: string | null,
) {
  if (!categoryId) return null;
  const cat = await db.category.findFirst({ where: { id: categoryId, deletedAt: null, OR: [{ userId: null }, { userId }] } });
  if (!cat) throw new AppError("Choose a valid category.", 400, "INVALID_CATEGORY", { categoryId: ["Choose a valid category"] });
  if (subCategoryId) {
    const sub = await db.subCategory.findFirst({ where: { id: subCategoryId, categoryId, deletedAt: null, OR: [{ userId: null }, { userId }] } });
    if (!sub) throw new AppError("Choose a valid sub-category.", 400, "INVALID_SUBCATEGORY", { subCategoryId: ["Choose a sub-category of the selected category"] });
  }
  return cat;
}

export async function createCategory(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(categorySchema, input);
  const clash = await prisma.category.findFirst({
    where: { kind: data.kind, deletedAt: null, name: { equals: data.name, mode: "insensitive" }, OR: [{ userId: null }, { userId }] },
  });
  if (clash) throw new AppError("A category with this name already exists.", 409, "DUPLICATE", { name: ["Already exists"] });
  return prisma.$transaction(async (tx) => {
    // Re-adding a previously deleted category restores it (unique name per user).
    const removed = await tx.category.findFirst({ where: { userId, kind: data.kind, name: { equals: data.name, mode: "insensitive" }, deletedAt: { not: null } } });
    const cat = removed
      ? await tx.category.update({ where: { id: removed.id }, data: { name: data.name, color: data.color, isFixed: data.isFixed, deletedAt: null } })
      : await tx.category.create({ data: { userId, name: data.name, kind: data.kind, color: data.color, isFixed: data.isFixed, sortOrder: 1000 } });
    await audit({ userId, action: AuditAction.CATEGORY_CREATED, entityType: "Category", entityId: cat.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
    return cat;
  });
}

async function ownCategory(userId: string, id: string) {
  const cat = await prisma.category.findFirst({ where: { id, deletedAt: null, OR: [{ userId: null }, { userId }] } });
  if (!cat) throw new NotFoundError("Category not found.");
  if (cat.userId !== userId) throw new ForbiddenError("Built-in categories can't be changed. Add your own instead.");
  return cat;
}

export async function updateCategory(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const existing = await ownCategory(userId, id);
  const data = parseOrThrow(categorySchema, { ...input as object, kind: existing.kind });
  const updated = await prisma.category.update({ where: { id }, data: { name: data.name, color: data.color, isFixed: data.isFixed } });
  await audit({ userId, action: AuditAction.CATEGORY_UPDATED, entityType: "Category", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return updated;
}

/** Soft delete. Existing transactions keep their category for history. */
export async function deleteCategory(userId: string, id: string, meta: RequestMeta = NO_META) {
  await ownCategory(userId, id);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.category.update({ where: { id }, data: { deletedAt: now } });
    await tx.subCategory.updateMany({ where: { categoryId: id }, data: { deletedAt: now } });
    await tx.categorizationRule.updateMany({ where: { userId, categoryId: id }, data: { isActive: false } });
    await tx.merchant.updateMany({ where: { userId, defaultCategoryId: id }, data: { defaultCategoryId: null, defaultSubCategoryId: null } });
    await audit({ userId, action: AuditAction.CATEGORY_DELETED, entityType: "Category", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

export async function createSubCategory(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const data = parseOrThrow(subCategorySchema, input);
  await assertCategory(prisma, userId, data.categoryId, null);
  const clash = await prisma.subCategory.findFirst({
    where: { categoryId: data.categoryId, deletedAt: null, name: { equals: data.name, mode: "insensitive" }, OR: [{ userId: null }, { userId }] },
  });
  if (clash) throw new AppError("This sub-category already exists.", 409, "DUPLICATE", { name: ["Already exists"] });
  const removed = await prisma.subCategory.findFirst({ where: { categoryId: data.categoryId, ownerKey: userId, name: { equals: data.name, mode: "insensitive" }, deletedAt: { not: null } } });
  const sub = removed
    ? await prisma.subCategory.update({ where: { id: removed.id }, data: { name: data.name, deletedAt: null } })
    : await prisma.subCategory.create({ data: { categoryId: data.categoryId, userId, ownerKey: userId, name: data.name, sortOrder: 1000 } });
  await audit({ userId, action: AuditAction.CATEGORY_CREATED, entityType: "SubCategory", entityId: sub.id, ip: meta.ip, userAgent: meta.userAgent });
  return sub;
}

export async function deleteSubCategory(userId: string, id: string, meta: RequestMeta = NO_META) {
  const sub = await prisma.subCategory.findFirst({ where: { id, deletedAt: null } });
  if (!sub) throw new NotFoundError("Sub-category not found.");
  if (sub.userId !== userId) throw new ForbiddenError("Built-in sub-categories can't be removed.");
  await prisma.subCategory.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ userId, action: AuditAction.CATEGORY_DELETED, entityType: "SubCategory", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

export type CategoryWhere = Prisma.CategoryWhereInput;
