import { z } from "zod";
import { last4Schema, moneySchema, optionalText } from "@/validators/common";

export const BANK_ACCOUNT_TYPES = ["SAVINGS", "CURRENT", "SALARY", "OTHER"] as const;
export const RECORD_STATUSES = ["ACTIVE", "INACTIVE", "CLOSED"] as const;

export const bankAccountSchema = z.object({
  bankName: z.string().trim().min(2, "Enter the bank name").max(80),
  nickname: z.string().trim().min(1, "Give the account a nickname").max(60),
  accountType: z.enum(BANK_ACCOUNT_TYPES),
  last4: z.union([last4Schema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
  /** Balance as shown by the bank today. Opening balance is derived from it. */
  currentBalance: moneySchema,
  currency: z.literal("INR").default("INR"),
  status: z.enum(RECORD_STATUSES).default("ACTIVE"),
  notes: optionalText(500),
});

export const cashAccountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(60),
  currentBalance: moneySchema,
  status: z.enum(RECORD_STATUSES).default("ACTIVE"),
  notes: optionalText(500),
});

export type BankAccountInput = z.input<typeof bankAccountSchema>;
export type CashAccountInput = z.input<typeof cashAccountSchema>;
