/**
 * Date helpers. Calendar dates (transaction date, due dates) are stored as
 * Postgres DATE and handled as UTC-midnight JS Dates. Display uses the user's
 * timezone (default Asia/Kolkata).
 */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type YearMonth = { year: number; month: number }; // month: 1-12

/** Today's calendar date in the given timezone, as a UTC-midnight Date. */
export function todayInTimezone(timezone = DEFAULT_TIMEZONE, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // YYYY-MM-DD
  return new Date(`${parts}T00:00:00.000Z`);
}

export function currentYearMonth(timezone = DEFAULT_TIMEZONE, now = new Date()): YearMonth {
  const t = todayInTimezone(timezone, now);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
}

/** Parse "YYYY-MM"; returns null when invalid. */
export function parseYearMonth(value: string | null | undefined): YearMonth | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 2200) return null;
  return { year, month };
}

export function formatYearMonth({ year, month }: YearMonth): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** [start, end) UTC-midnight range covering the calendar month. */
export function monthRange({ year, month }: YearMonth): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Date with the given day-of-month, clamped to the month's length (31 → 30 Sep). */
export function dateWithDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, Math.min(day, daysInMonth(year, month))));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Whole calendar days from `from` to `to` (both UTC-midnight dates). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** dd-MMM-yyyy (e.g. 05-Oct-2026). DATE columns are UTC-midnight, so UTC is used by default. */
export function formatDate(date: Date | string | null | undefined, timezone = "UTC"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d); // YYYY-MM-DD
  const [y, m, day] = parts.split("-");
  return `${day}-${MONTHS[Number(m) - 1]}-${y}`;
}

export function monthLabel({ year, month }: YearMonth, style: "long" | "short" = "long"): string {
  if (style === "short") return `${MONTHS[month - 1]} ${year}`;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}
