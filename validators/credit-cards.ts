import { z } from "zod";
import { dayOfMonth, last4Schema, moneySchema, nonNegativeMoney, optionalDate, optionalText, positiveMoney } from "@/validators/common";

export const CARD_NETWORKS = ["VISA", "MASTERCARD", "RUPAY", "AMEX", "DINERS", "OTHER"] as const;
export const CARD_STATUSES = ["ACTIVE", "BLOCKED", "CLOSED"] as const;

export const creditCardSchema = z
  .object({
    bankName: z.string().trim().min(2, "Enter the bank name").max(80),
    cardName: z.string().trim().min(1, "Enter the card name").max(60),
    network: z.enum(CARD_NETWORKS).default("OTHER"),
    last4: last4Schema,
    creditLimit: positiveMoney,
    statementDay: dayOfMonth,
    paymentDueDay: dayOfMonth,
    /** Amount currently used on the card (from the app/statement). */
    currentOutstanding: moneySchema,
    totalAmountDue: nonNegativeMoney.default("0"),
    minimumAmountDue: nonNegativeMoney.default("0"),
    currentDueDate: optionalDate,
    /** Already paid on this bill outside FinSight360 (no bank transaction is created). */
    paidOnBill: nonNegativeMoney.default("0"),
    annualFee: nonNegativeMoney.default("0"),
    rewardPoints: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
    status: z.enum(CARD_STATUSES).default("ACTIVE"),
    notes: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (Number(v.minimumAmountDue) > Number(v.totalAmountDue)) {
      ctx.addIssue({ code: "custom", path: ["minimumAmountDue"], message: "Minimum due can't exceed total due" });
    }
    if (Number(v.paidOnBill) > Number(v.totalAmountDue)) {
      ctx.addIssue({ code: "custom", path: ["paidOnBill"], message: "Can't be more than the total due" });
    }
  });

export type CreditCardInput = z.input<typeof creditCardSchema>;
