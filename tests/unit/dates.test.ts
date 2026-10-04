import { describe, expect, it } from "vitest";
import { addMonths, currentYearMonth, dateWithDay, daysBetween, formatDate, monthRange, parseYearMonth, todayInTimezone } from "@/lib/dates";

describe("dates", () => {
  it("uses the user's timezone to decide 'today' (IST vs UTC)", () => {
    // 20:00 UTC on 31 Mar is already 1 Apr 01:30 in India.
    const instant = new Date("2026-03-31T20:00:00Z");
    expect(todayInTimezone("Asia/Kolkata", instant).toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(todayInTimezone("UTC", instant).toISOString()).toBe("2026-03-31T00:00:00.000Z");
    expect(currentYearMonth("Asia/Kolkata", instant)).toEqual({ year: 2026, month: 4 });
  });

  it("builds half-open month ranges", () => {
    const { start, end } = monthRange({ year: 2026, month: 12 });
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("adds months across years", () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 11 }, 3)).toEqual({ year: 2027, month: 2 });
  });

  it("clamps day-of-month to month length", () => {
    expect(dateWithDay(2026, 2, 31).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(dateWithDay(2028, 2, 31).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("parses YYYY-MM and rejects junk", () => {
    expect(parseYearMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("abc")).toBeNull();
  });

  it("counts days and formats dd-MMM-yyyy", () => {
    expect(daysBetween(new Date("2026-10-04T00:00:00Z"), new Date("2026-10-05T00:00:00Z"))).toBe(1);
    expect(formatDate(new Date("2026-10-05T00:00:00Z"))).toBe("05-Oct-2026");
    expect(formatDate(new Date("2026-09-27T00:00:00Z"))).toBe("27-Sep-2026");
    expect(formatDate(new Date("2026-10-04T20:00:00Z"), "Asia/Kolkata")).toBe("05-Oct-2026");
  });
});
