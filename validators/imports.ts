import { z } from "zod";
import { DATE_FORMATS } from "@/lib/import/values";
import { idSchema, optionalId } from "@/validators/common";

const col = z.coerce.number().int().min(0).max(200);
const optionalCol = z
  .union([col, z.literal(""), z.null()])
  .optional()
  .transform((v) => (typeof v === "number" ? v : null));

export const importAccountSchema = z
  .string()
  .regex(/^(bank|card):[A-Za-z0-9_-]+$/, "Choose the bank account or credit card this statement belongs to");

export const columnMappingSchema = z
  .object({
    headerRowIndex: z.coerce.number().int().min(0).max(100),
    dateFormat: z.enum(DATE_FORMATS),
    amountMode: z.enum(["SIGNED_AMOUNT", "DEBIT_CREDIT_COLUMNS", "AMOUNT_WITH_TYPE_COLUMN"]),
    /** For SIGNED_AMOUNT: whether a positive number is money in (most banks) or money out (most card exports). */
    positiveIs: z.enum(["CREDIT", "DEBIT"]).default("CREDIT"),
    transactionDate: col,
    description: col,
    debit: optionalCol,
    credit: optionalCol,
    amount: optionalCol,
    type: optionalCol,
    referenceNumber: optionalCol,
    balance: optionalCol,
    saveTemplateName: z
      .string()
      .trim()
      .max(60)
      .optional()
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .superRefine((v, ctx) => {
    if (v.amountMode === "DEBIT_CREDIT_COLUMNS") {
      if (v.debit === null) ctx.addIssue({ code: "custom", path: ["debit"], message: "Choose the debit / withdrawal column" });
      if (v.credit === null) ctx.addIssue({ code: "custom", path: ["credit"], message: "Choose the credit / deposit column" });
    } else {
      if (v.amount === null) ctx.addIssue({ code: "custom", path: ["amount"], message: "Choose the amount column" });
      if (v.amountMode === "AMOUNT_WITH_TYPE_COLUMN" && v.type === null) ctx.addIssue({ code: "custom", path: ["type"], message: "Choose the Dr/Cr column" });
    }
  });

export type ColumnMappingData = z.output<typeof columnMappingSchema>;

export const IMPORT_TYPES = ["EXPENSE", "INCOME", "REFUND", "REVERSAL", "INTEREST", "FEE", "ATM_WITHDRAWAL", "EMI", "INVESTMENT", "CARD_PAYMENT", "OTHER"] as const;

export const importRowUpdateSchema = z.object({
  include: z.boolean().optional(),
  transactionType: z.enum(IMPORT_TYPES).optional(),
  categoryId: optionalId,
  subCategoryId: optionalId,
});

export const bulkIncludeSchema = z.object({
  include: z.boolean(),
  status: z.enum(["VALID", "POSSIBLE_DUPLICATE", "DUPLICATE", "ALL"]).default("ALL"),
});

export const duplicateActionSchema = z.object({
  action: z.enum(["CONFIRM_DUPLICATE", "KEEP_BOTH", "MERGE", "IGNORE"]),
});

export const reviewActionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  ids: z.array(idSchema).min(1, "Select at least one transaction").max(500),
});
