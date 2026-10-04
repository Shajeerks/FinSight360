import { Decimal, percentOf, roundMoney, type MoneyInput, sum } from "@/lib/money";
import { daysBetween, dateWithDay, type YearMonth, addMonths } from "@/lib/dates";

export type CardUtilization = {
  creditLimit: Decimal;
  outstanding: Decimal;
  availableLimit: Decimal;
  /** Percentage, 2 dp. Can exceed 100 when over-limit. */
  utilizationPct: Decimal;
  isOverLimit: boolean;
};

export function cardUtilization(creditLimit: MoneyInput, outstanding: MoneyInput): CardUtilization {
  const limit = roundMoney(creditLimit);
  const used = roundMoney(outstanding);
  const available = Decimal.max(limit.minus(used), 0);
  return {
    creditLimit: limit,
    outstanding: used,
    availableLimit: roundMoney(available),
    utilizationPct: percentOf(used, limit, 2),
    isOverLimit: used.greaterThan(limit),
  };
}

export type DueStatus = "NO_DUE" | "UPCOMING" | "DUE_SOON" | "DUE_TODAY" | "OVERDUE";

export type CardDueInfo = {
  dueDate: Date | null;
  daysRemaining: number | null;
  status: DueStatus;
  amountDue: Decimal;
};

/**
 * @param today calendar date (UTC-midnight) in the user's timezone
 * @param dueSoonDays window that counts as "due soon"
 */
export function cardDueInfo(
  input: { dueDate: Date | null; totalAmountDue: MoneyInput },
  today: Date,
  dueSoonDays = 5,
): CardDueInfo {
  const amountDue = roundMoney(input.totalAmountDue);
  if (!input.dueDate || amountDue.lessThanOrEqualTo(0)) {
    return { dueDate: input.dueDate, daysRemaining: input.dueDate ? daysBetween(today, input.dueDate) : null, status: "NO_DUE", amountDue };
  }
  const days = daysBetween(today, input.dueDate);
  const status: DueStatus = days < 0 ? "OVERDUE" : days === 0 ? "DUE_TODAY" : days <= dueSoonDays ? "DUE_SOON" : "UPCOMING";
  return { dueDate: input.dueDate, daysRemaining: days, status, amountDue };
}

/** Next occurrence of `dueDay` on or after `today`. */
export function nextDueDateFromDay(dueDay: number, today: Date): Date {
  const ym: YearMonth = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  const thisMonth = dateWithDay(ym.year, ym.month, dueDay);
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const next = addMonths(ym, 1);
  return dateWithDay(next.year, next.month, dueDay);
}

export type PortfolioUtilization = CardUtilization & { cardCount: number };

export function totalUtilization(cards: { creditLimit: MoneyInput; outstanding: MoneyInput }[]): PortfolioUtilization {
  const limit = sum(cards.map((c) => c.creditLimit));
  const used = sum(cards.map((c) => c.outstanding));
  return { ...cardUtilization(limit, used), cardCount: cards.length };
}

