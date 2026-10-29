import { z } from "zod";
import { idSchema, moneySchema, optionalDate, optionalText } from "@/validators/common";

export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");
export const lenderKeySchema = z.string().regex(/^(card|loan|lender):[A-Za-z0-9_-]{1,64}$/, "Invalid lender");

/** Empty = "calculate it for me". Amounts can be negative only for the change column (not stored). */
const optionalAmount = z
  .union([moneySchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v === "" || v === null || v === undefined ? null : v));
const optionalNonNegative = optionalAmount.refine((v) => v === null || Number(v) >= 0, "Can't be negative");

export const debtEntrySchema = z.object({
  month: monthParam,
  lenderKey: lenderKeySchema,
  openingOutstanding: optionalAmount,
  newBorrowing: optionalAmount,
  payment: optionalNonNegative,
  paidToDate: optionalNonNegative,
  interest: optionalAmount,
  closingOutstanding: optionalAmount,
  remainingEmis: z
    .union([z.literal(""), z.null(), z.coerce.number().int("Whole number").min(0, "Can't be negative").max(600)])
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  notes: optionalText(300),
});
export type DebtEntryInput = z.input<typeof debtEntrySchema>;

export const debtLenderSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  kind: z.enum(["PERSON", "OTHER"]).default("PERSON"),
  matchText: optionalText(80),
  openingOutstanding: moneySchema.refine((v) => Number(v) >= 0, "Can't be negative").default("0"),
  openingDate: optionalDate,
  monthlyRatePct: z.coerce.number().min(0, "Can't be negative").max(20, "That's more than 20% a month").default(0),
  notes: optionalText(300),
  closed: z.union([z.boolean(), z.enum(["true", "false", "on", ""])]).optional().transform((v) => v === true || v === "true" || v === "on"),
});
export type DebtLenderInput = z.input<typeof debtLenderSchema>;

export const applyEmiSchema = z.object({ loanId: idSchema, transactionId: idSchema });

/** Excel import: the rows read from the workbook (sent back after you check them), mapped to lenders. */
const excelAmount = z.union([moneySchema, z.null()]).transform((v) => v ?? null);
export const debtExcelRowSchema = z.object({
  month: monthParam,
  lender: z.string().trim().min(1).max(120),
  openingOutstanding: excelAmount,
  payment: excelAmount,
  paidToDate: excelAmount,
  closingOutstanding: excelAmount,
  interest: excelAmount,
  remainingEmis: z.number().int().min(0).max(600).nullable(),
});
export type DebtExcelRow = z.output<typeof debtExcelRowSchema>;

export const debtExcelCommitSchema = z.object({
  rows: z.array(debtExcelRowSchema).min(1, "Nothing to import").max(5000, "Too many rows"),
  /** Excel lender name → "card:id" | "loan:id" | "lender:id" | "new" (create an "other lender") | "skip" */
  mapping: z.record(z.string().max(120), z.string().regex(/^((card|loan|lender):[A-Za-z0-9_-]{1,64}|new|skip)$/)),
  /** Replace figures you already entered for the same lender and month. */
  overwrite: z.boolean().default(false),
});
