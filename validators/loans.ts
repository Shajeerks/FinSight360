import { z } from "zod";
import { boolField, dateSchema, last4Schema, moneySchema, optionalId, optionalText, positiveMoney } from "@/validators/common";

export const LOAN_TYPES = ["HOME", "CAR", "PERSONAL", "EDUCATION", "OTHER"] as const;
export const INTEREST_TYPES = ["FIXED", "FLOATING"] as const;
export const EMI_FREQUENCIES = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "YEARLY"] as const;
export const LOAN_PAYMENT_TYPES = ["EMI", "PREPAYMENT", "FORECLOSURE", "CHARGE"] as const;

const rateSchema = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,2}(\.\d{1,4})?$/.test(v) && Number(v) >= 0 && Number(v) <= 60, "Enter an annual rate between 0 and 60% (up to 4 decimals)");

const optionalMoney = z.union([moneySchema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optionalCount = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || String(v).trim() === "" ? null : Number(String(v).trim())))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 600), "Enter a whole number of EMIs (0–600)");

export const loanSchema = z
  .object({
    name: z.string().trim().min(2, "Name the loan").max(60),
    lender: z.string().trim().min(2, "Enter the lender").max(80),
    loanType: z.enum(LOAN_TYPES),
    accountLast4: z.union([last4Schema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
    principal: positiveMoney,
    interestRate: rateSchema,
    interestType: z.enum(INTEREST_TYPES).default("FIXED"),
    startDate: dateSchema,
    firstEmiDate: dateSchema,
    tenureMonths: z.coerce.number().int("Whole months only").min(1, "At least 1 month").max(600, "Max 600 months"),
    emiFrequency: z.enum(EMI_FREQUENCIES).default("MONTHLY"),
    /** Lender's EMI. Leave blank to calculate it. */
    emiAmount: optionalMoney,
    roundEmiToRupee: boolField,
    repaymentAccountId: optionalId,
    /** For loans that started before you used FinSight360: mark past EMIs as paid (no ledger entries are created). */
    markPastAsPaid: boolField,
    /** How many EMIs were already paid before FinSight360 (overrides markPastAsPaid when given). */
    emisPaid: optionalCount,
    /** Outstanding principal as shown by the lender today (optional). */
    outstandingAsPerBank: optionalMoney,
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.firstEmiDate < v.startDate) ctx.addIssue({ code: "custom", path: ["firstEmiDate"], message: "First EMI can't be before the start date" });
    const per = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 }[v.emiFrequency];
    if (v.tenureMonths % per !== 0) ctx.addIssue({ code: "custom", path: ["tenureMonths"], message: `Tenure must be a multiple of ${per} months for this frequency` });
  });

export const loanDetailsSchema = z.object({
  name: z.string().trim().min(2).max(60),
  lender: z.string().trim().min(2).max(80),
  accountLast4: z.union([last4Schema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  interestType: z.enum(INTEREST_TYPES),
  repaymentAccountId: optionalId,
  notes: optionalText(500),
});

export const loanPaymentSchema = z
  .object({
    paymentType: z.enum(LOAN_PAYMENT_TYPES).default("EMI"),
    paymentDate: dateSchema,
    amount: positiveMoney,
    /** "bank:<id>" | "cash:<id>" — required when recording in the ledger. */
    account: z.string().optional().nullable(),
    recordInLedger: boolField.optional().default(true),
    scheduleId: optionalId,
    prepaymentMode: z.enum(["REDUCE_TENURE", "REDUCE_EMI"]).default("REDUCE_TENURE"),
    notes: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (v.recordInLedger && !/^(bank|cash):[A-Za-z0-9_-]+$/.test(v.account ?? "")) {
      ctx.addIssue({ code: "custom", path: ["account"], message: "Choose the account the payment came from" });
    }
  });

export const rateRevisionSchema = z.object({
  interestRate: rateSchema,
  mode: z.enum(["KEEP_EMI", "KEEP_TENURE"]).default("KEEP_EMI"),
});

export const emiPreviewSchema = z.object({
  principal: positiveMoney,
  interestRate: rateSchema,
  tenureMonths: z.coerce.number().int().min(1).max(600),
  emiFrequency: z.enum(EMI_FREQUENCIES).default("MONTHLY"),
  roundEmiToRupee: boolField,
});

export type LoanInput = z.input<typeof loanSchema>;
export type LoanDetailsInput = z.input<typeof loanDetailsSchema>;
export type LoanPaymentInput = z.input<typeof loanPaymentSchema>;
export type RateRevisionInput = z.input<typeof rateRevisionSchema>;
export type LoanProgressInput = z.input<typeof loanProgressSchema>;

/** Repayment progress made before the loan was tracked in FinSight360. */
export const loanProgressSchema = z.object({
  emisPaid: z.coerce.number({ message: "Enter how many EMIs you've paid" }).int("Whole EMIs only").min(0, "Can't be negative").max(600),
  outstandingAsPerBank: optionalMoney,
});
