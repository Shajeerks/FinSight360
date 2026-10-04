import { Prisma } from "@prisma/client";

/**
 * Decimal-safe money helpers. All financial arithmetic goes through
 * Prisma.Decimal (decimal.js) — never JavaScript floating point.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | string | number | null | undefined;

export const ZERO = new Decimal(0);

export function toDecimal(value: MoneyInput): Prisma.Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

export function sum(values: MoneyInput[]): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Round half-up to 2 decimals (paise). */
export function roundMoney(value: MoneyInput): Prisma.Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** (part / whole) * 100, rounded to `dp` places. Returns 0 when whole is 0. */
export function percentOf(part: MoneyInput, whole: MoneyInput, dp = 2): Prisma.Decimal {
  const w = toDecimal(whole);
  if (w.isZero()) return new Decimal(0);
  return toDecimal(part).div(w).times(100).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

const inrFormatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, fractionDigits: number, compact: boolean) {
  const key = `${currency}:${fractionDigits}:${compact}`;
  let f = inrFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      minimumFractionDigits: compact ? 0 : fractionDigits,
      maximumFractionDigits: fractionDigits,
      notation: compact ? "compact" : "standard",
    });
    inrFormatters.set(key, f);
  }
  return f;
}

/**
 * Format with Indian digit grouping: ₹2,00,000.00
 * Formatting is display-only; the Decimal → Number conversion happens last.
 */
export function formatMoney(
  value: MoneyInput,
  opts: { currency?: string; decimals?: number; compact?: boolean } = {},
): string {
  const { currency = "INR", decimals = 2, compact = false } = opts;
  const d = roundMoney(value);
  return formatter(currency, compact ? 1 : decimals, compact).format(d.toNumber());
}

export function formatPercent(value: MoneyInput, decimals = 2): string {
  return `${toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals)}%`;
}

/** Serialize for the client as a fixed 2-dp string (lossless). */
export function moneyString(value: MoneyInput): string {
  return roundMoney(value).toFixed(2);
}
