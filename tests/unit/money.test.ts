import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent, percentOf, roundMoney, sum, toDecimal } from "@/lib/money";

describe("money (decimal-safe)", () => {
  it("adds without floating-point drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the bug we avoid
    expect(sum(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(sum([0.1, 0.2, "1250.55", null, undefined]).toString()).toBe("1250.85");
  });

  it("rounds half-up to paise", () => {
    expect(roundMoney("10.005").toFixed(2)).toBe("10.01");
    expect(roundMoney("10.004").toFixed(2)).toBe("10.00");
  });

  it("computes percentages safely", () => {
    expect(percentOf(50000, 200000).toFixed(2)).toBe("25.00");
    expect(percentOf(1, 0).toNumber()).toBe(0);
  });

  it("formats INR with Indian digit grouping", () => {
    expect(formatMoney(200000)).toBe("₹2,00,000.00");
    expect(formatMoney("1020000", { decimals: 0 })).toBe("₹10,20,000");
    expect(formatMoney(-1250.5)).toBe("-₹1,250.50");
    expect(formatPercent("32.249")).toBe("32.25%");
  });

  it("treats empty input as zero", () => {
    expect(toDecimal("").toNumber()).toBe(0);
  });
});
