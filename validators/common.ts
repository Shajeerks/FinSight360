import { z } from "zod";

const MONEY_RE = /^-?\d{1,13}(\.\d{1,2})?$/;

/** Decimal amount as a string (max 2 decimals, max 13 integer digits). Accepts "1,250.50". */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/[,₹\s]/g, ""))
  .refine((v) => MONEY_RE.test(v), "Enter a valid amount (up to 2 decimals)");

export const positiveMoney = moneySchema.refine((v) => Number(v) > 0, "Amount must be greater than zero");
export const nonNegativeMoney = moneySchema.refine((v) => Number(v) >= 0, "Amount cannot be negative");

/** "YYYY-MM-DD" calendar date → UTC-midnight Date. */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker (YYYY-MM-DD)")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "Invalid date")
  .transform((v) => new Date(`${v}T00:00:00.000Z`));

export const optionalDate = z
  .union([dateSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Max ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Last 4 digits only — never full card/account numbers. */
export const last4Schema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Enter only the last 4 digits");

export const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
export const optionalId = z
  .union([idSchema, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const dayOfMonth = z
  .union([z.coerce.number().int().min(1, "1–31").max(31, "1–31"), z.literal(""), z.null()])
  .optional()
  .transform((v) => (typeof v === "number" ? v : null));

export function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Boolean that understands form/JSON values: true/false, "true"/"false", "on", "1"/"0". */
export const boolField = z
  .union([z.boolean(), z.enum(["true", "false", "on", "off", "1", "0", ""])])
  .optional()
  .transform((v) => v === true || v === "true" || v === "on" || v === "1");

/** Positive integer page number from a query string (bad values → 1). */
export function pageNumber(v: unknown): number {
  const n = Math.floor(Number(Array.isArray(v) ? v[0] : v));
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}
