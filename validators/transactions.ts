import { z } from "zod";
import { TRANSACTION_KINDS, KIND_SPECS, parseAccountRef } from "@/lib/transactions/kinds";
import { boolField, dateSchema, moneySchema, optionalId, optionalText, positiveMoney } from "@/validators/common";

export const INCOME_CATEGORIES = ["SALARY", "FREELANCE", "BUSINESS", "RENTAL", "INTEREST", "INVESTMENT", "OTHER"] as const;
export const PAYMENT_METHODS = ["CASH", "UPI", "DEBIT_CARD", "CREDIT_CARD", "NET_BANKING", "BANK_TRANSFER", "WALLET", "OTHER"] as const;

const accountRef = z
  .string()
  .refine((v) => parseAccountRef(v) !== null, "Choose an account");

export const transactionSchema = z
  .object({
    kind: z.enum(TRANSACTION_KINDS),
    transactionDate: dateSchema,
    amount: positiveMoney,
    /** Account the money left / arrived in. For a transfer: the FROM account. */
    account: accountRef,
    /** Transfer: destination account. */
    toAccount: z.string().optional().nullable(),
    /** Card payment: the card being paid. */
    creditCardId: optionalId,
    description: z.string().trim().min(1, "Add a short description").max(300),
    merchantName: optionalText(120),
    categoryId: optionalId,
    subCategoryId: optionalId,
    referenceNumber: optionalText(64),
    notes: optionalText(1000),
    paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
    incomeCategory: z.enum(INCOME_CATEGORIES).optional().nullable(),
    sourceName: optionalText(120),
    isRecurring: boolField,
    /** Remember this category for future transactions from the same merchant. */
    applyToMerchant: boolField,
  })
  .superRefine((v, ctx) => {
    const spec = KIND_SPECS[v.kind];
    const acct = parseAccountRef(v.account);
    if (acct && !spec.accounts.includes(acct.kind)) {
      ctx.addIssue({ code: "custom", path: ["account"], message: `A ${spec.label.toLowerCase()} can't use this type of account` });
    }
    if (v.kind === "TRANSFER") {
      const to = parseAccountRef(v.toAccount);
      if (!to || to.kind === "card") ctx.addIssue({ code: "custom", path: ["toAccount"], message: "Choose the destination account" });
      else if (to.kind === acct?.kind && to.id === acct?.id) ctx.addIssue({ code: "custom", path: ["toAccount"], message: "Choose a different account" });
    }
    if (v.kind === "CARD_PAYMENT" && !v.creditCardId) {
      ctx.addIssue({ code: "custom", path: ["creditCardId"], message: "Choose the card you paid" });
    }
    if (v.subCategoryId && !v.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose a category" });
    }
  });

export type TransactionInput = z.input<typeof transactionSchema>;
export type TransactionData = z.output<typeof transactionSchema>;

/** Query-string filters for the transaction list (§38). */
export const transactionFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  account: z.string().regex(/^(bank|card|cash):[A-Za-z0-9_-]+$/).optional(),
  category: z.string().max(64).optional(),
  subCategory: z.string().max(64).optional(),
  merchant: z.string().trim().max(100).optional(),
  min: moneySchema.optional(),
  max: moneySchema.optional(),
  type: z.enum(["INCOME", "EXPENSE", "TRANSFER", "CARD_PAYMENT", "EMI", "INVESTMENT", "REFUND", "REVERSAL", "INTEREST", "FEE", "ATM_WITHDRAWAL", "OTHER"]).optional(),
  direction: z.enum(["DEBIT", "CREDIT"]).optional(),
  source: z.enum(["MANUAL", "GMAIL", "OUTLOOK", "CSV", "XLSX", "PDF", "FUTURE_ANDROID_SMS", "GROWW", "SYSTEM"]).optional(),
  duplicate: z.enum(["NOT_CHECKED", "UNIQUE", "POSSIBLE_DUPLICATE", "DUPLICATE", "MERGED"]).optional(),
  origin: z.enum(["manual", "imported"]).optional(),
  status: z.enum(["PENDING_REVIEW", "CONFIRMED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export type TransactionFilters = z.output<typeof transactionFilterSchema>;

/** Parse URLSearchParams / Next searchParams, dropping empty values and anything invalid. */
export function parseTransactionFilters(input: Record<string, string | string[] | undefined>): TransactionFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") flat[k] = val;
  }
  const res = transactionFilterSchema.safeParse(flat);
  if (res.success) return res.data;
  // Drop only the invalid keys.
  const bad = new Set(res.error.issues.map((i) => String(i.path[0])));
  for (const k of bad) delete flat[k];
  return transactionFilterSchema.parse(flat);
}

export const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(40),
  kind: z.enum(["EXPENSE", "INCOME"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour").default("#64748b"),
  isFixed: boolField,
});

export const subCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2, "Enter a name").max(40),
});

export const ruleSchema = z
  .object({
    name: z.string().trim().max(80).optional().nullable(),
    matchType: z.enum(["MERCHANT", "KEYWORD", "AMOUNT"]),
    pattern: optionalText(80),
    amountMin: z.union([moneySchema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
    amountMax: z.union([moneySchema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
    direction: z.union([z.enum(["DEBIT", "CREDIT"]), z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
    categoryId: z.string().min(1, "Choose a category"),
    subCategoryId: optionalId,
    priority: z.coerce.number().int().min(1).max(10_000).default(100),
    isActive: boolField.optional().default(true),
  })
  .superRefine((v, ctx) => {
    if ((v.matchType === "MERCHANT" || v.matchType === "KEYWORD") && !v.pattern) {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: "Enter the merchant name or keyword to match" });
    }
    if (v.matchType === "AMOUNT" && !v.amountMin && !v.amountMax) {
      ctx.addIssue({ code: "custom", path: ["amountMin"], message: "Enter a minimum and/or maximum amount" });
    }
    if (v.amountMin && v.amountMax && Number(v.amountMin) > Number(v.amountMax)) {
      ctx.addIssue({ code: "custom", path: ["amountMax"], message: "Max must be ≥ min" });
    }
  });

export type CategoryInput = z.input<typeof categorySchema>;
export type SubCategoryInput = z.input<typeof subCategorySchema>;
export type RuleInput = z.input<typeof ruleSchema>;
