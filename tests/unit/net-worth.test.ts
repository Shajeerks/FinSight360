import { describe, expect, it } from "vitest";
import { computeNetWorth } from "@/lib/finance/net-worth";

describe("net worth", () => {
  it("assets − liabilities", () => {
    const n = computeNetWorth({
      bankBalances: ["184250.00", "92400.00"],
      cashBalances: [3500],
      investmentValues: ["1020000.00"],
      loanOutstanding: ["350000.55"],
      creditCardOutstanding: [64500, 18200, 9850],
    });
    expect(n.totalAssets.toFixed(2)).toBe("1300150.00");
    expect(n.totalLiabilities.toFixed(2)).toBe("442550.55");
    expect(n.netWorth.toFixed(2)).toBe("857599.45");
  });

  it("can be negative and handles empty input", () => {
    expect(computeNetWorth({ bankBalances: [1000], loanOutstanding: [5000] }).netWorth.toFixed(2)).toBe("-4000.00");
    expect(computeNetWorth({ bankBalances: [] }).netWorth.toFixed(2)).toBe("0.00");
  });
});
