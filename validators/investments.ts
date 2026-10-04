import { z } from "zod";
import { dateSchema, idSchema, nonNegativeMoney, optionalText } from "@/validators/common";

export const INSTRUMENT_TYPES = ["MUTUAL_FUND", "STOCK", "ETF", "BOND", "FIXED_DEPOSIT", "GOLD", "OTHER"] as const;
export const INV_ACCOUNT_TYPES = ["DEMAT", "MUTUAL_FUND", "BROKERAGE", "OTHER"] as const;
export const INV_TXN_TYPES = ["BUY", "SIP", "SELL", "REDEMPTION", "DIVIDEND", "SWITCH_IN", "SWITCH_OUT", "BONUS", "SPLIT"] as const;

/** Units / quantity: up to 6 decimals (mutual-fund units). */
const quantity = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/[,\s]/g, ""))
  .refine((v) => /^\d{1,12}(\.\d{1,6})?$/.test(v), "Enter a quantity (up to 6 decimals)");
/** Price / NAV: up to 4 decimals. */
const price = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).replace(/[,₹\s]/g, ""))
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), "Enter a price (up to 4 decimals)");
const optionalPrice = z.union([price, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));
const optionalMoney = z.union([nonNegativeMoney, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null));

const isin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^IN[A-Z0-9]{10}$/.test(v), "ISIN looks like INE002A01018 (12 characters)");

export const investmentAccountSchema = z.object({
  name: z.string().trim().min(2, "Name the account (e.g. Groww stocks)").max(80),
  providerType: z.enum(["MANUAL", "GROWW", "OTHER"]).default("MANUAL"),
  providerName: optionalText(60),
  accountType: z.enum(INV_ACCOUNT_TYPES).default("OTHER"),
  notes: optionalText(500),
});

const instrument = {
  instrumentName: z.string().trim().min(2, "Enter the fund / stock name").max(160),
  instrumentType: z.enum(INSTRUMENT_TYPES),
  isin,
  symbol: optionalText(20).transform((v) => (v ? v.toUpperCase() : null)),
};

/** A holding entered as it stands today (no transaction history). */
export const holdingSchema = z
  .object({
    investmentAccountId: idSchema,
    ...instrument,
    quantity,
    averageBuyPrice: optionalPrice,
    investedAmount: optionalMoney,
    currentPrice: optionalPrice,
  })
  .superRefine((v, ctx) => {
    if (!v.averageBuyPrice && !v.investedAmount) ctx.addIssue({ code: "custom", path: ["averageBuyPrice"], message: "Enter the average buy price or the invested amount" });
    if (Number(v.quantity) <= 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity must be more than zero" });
    const value = Number(v.quantity) * Number(v.currentPrice ?? v.averageBuyPrice ?? 0);
    if (value >= 1e14 || Number(v.investedAmount ?? 0) >= 1e14) ctx.addIssue({ code: "custom", path: ["quantity"], message: "That value is too large" });
  });

export const investmentTxnSchema = z
  .object({
    investmentAccountId: idSchema,
    holdingId: z.union([idSchema, z.literal(""), z.null()]).optional().transform((v) => (v ? v : null)),
    instrumentName: z.string().trim().max(160).optional().nullable(),
    instrumentType: z.enum(INSTRUMENT_TYPES).optional().nullable(),
    isin,
    symbol: optionalText(20).transform((v) => (v ? v.toUpperCase() : null)),
    type: z.enum(INV_TXN_TYPES),
    tradeDate: dateSchema,
    quantity: quantity.optional().default("0"),
    price: optionalPrice,
    amount: optionalMoney,
    charges: nonNegativeMoney.default("0"),
    notes: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (!v.holdingId && (!v.instrumentName || v.instrumentName.length < 2)) ctx.addIssue({ code: "custom", path: ["instrumentName"], message: "Choose a holding or enter the fund / stock name" });
    if (!v.holdingId && !v.instrumentType) ctx.addIssue({ code: "custom", path: ["instrumentType"], message: "Choose the instrument type" });
    if (v.type !== "DIVIDEND" && Number(v.quantity) <= 0) ctx.addIssue({ code: "custom", path: ["quantity"], message: "Enter the units / quantity" });
    if (!["BONUS", "SPLIT"].includes(v.type) && !v.amount && !v.price) ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter the amount or the price" });
    if (Number(v.quantity) * Number(v.price ?? 0) >= 1e14 || Number(v.amount ?? 0) >= 1e14) ctx.addIssue({ code: "custom", path: ["amount"], message: "That value is too large" });
    if (v.tradeDate.getTime() > Date.now() + 86_400_000) ctx.addIssue({ code: "custom", path: ["tradeDate"], message: "Date can't be in the future" });
  });

export const priceUpdateSchema = z.object({ currentPrice: price.refine((v) => Number(v) < 1e10, "That price is too large") });

export type InvestmentAccountInput = z.input<typeof investmentAccountSchema>;
export type HoldingInput = z.input<typeof holdingSchema>;
export type InvestmentTxnInput = z.input<typeof investmentTxnSchema>;
