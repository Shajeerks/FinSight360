import { describe, expect, it } from "vitest";
import { containsWord, extractMerchant, merchantKey, normalizeDescription, normalizeText } from "@/lib/transactions/normalize";
import { allowedKindsFor, categorize, type RuleForMatching } from "@/lib/categorization/engine";
import { accountBalance, cardOutstanding, openingForTarget } from "@/lib/finance/balances";

describe("transaction normalization", () => {
  it("normalizes text", () => {
    expect(normalizeText("  Amazon.in — Order #123 ")).toBe("AMAZON IN ORDER 123");
    expect(normalizeText(null)).toBe("");
  });

  it("removes reference numbers, UPI handles and card masks", () => {
    expect(normalizeDescription("UPI/412345678901/SWIGGY/swiggy@icici/Payment")).toBe("UPI SWIGGY PAYMENT");
    expect(normalizeDescription("POS 4512XXXX1234 AMAZON PAY INDIA")).toBe("POS 4512 AMAZON PAY INDIA");
  });

  it("treats 'Amazon' and 'AMAZON' as the same merchant", () => {
    expect(merchantKey("Amazon")).toBe(merchantKey("AMAZON"));
    expect(merchantKey("Swiggy Pvt. Ltd.")).toBe("SWIGGY");
  });

  it("extracts a merchant from noisy descriptions", () => {
    expect(extractMerchant("UPI/412345678901/SWIGGY/swiggy@icici/Payment")).toBe("SWIGGY");
    expect(extractMerchant("UPI-ZOMATO LTD-zomato@hdfc-123456789")).toBe("ZOMATO LTD");
    expect(extractMerchant("NETFLIX.COM SUBSCRIPTION")).toBe("NETFLIX COM");
    expect(extractMerchant("123456789")).toBeNull();
  });

  it("matches whole words only", () => {
    expect(containsWord("UBER TRIP BLR", "uber")).toBe(true);
    expect(containsWord("UBERTY STORE", "uber")).toBe(false);
  });
});

const rule = (r: Partial<RuleForMatching> & Pick<RuleForMatching, "id" | "matchType" | "categoryId">): RuleForMatching => ({
  pattern: null, amountMin: null, amountMax: null, direction: null, subCategoryId: null, categoryKind: "EXPENSE", priority: 100, isActive: true, ...r,
});

describe("categorization rules", () => {
  const rules: RuleForMatching[] = [
    rule({ id: "swiggy", matchType: "MERCHANT", pattern: "SWIGGY", categoryId: "food", subCategoryId: "delivery" }),
    rule({ id: "zomato", matchType: "MERCHANT", pattern: "ZOMATO", categoryId: "food", subCategoryId: "delivery" }),
    rule({ id: "uber", matchType: "MERCHANT", pattern: "UBER", categoryId: "transport", subCategoryId: "taxi" }),
    rule({ id: "netflix", matchType: "MERCHANT", pattern: "NETFLIX", categoryId: "entertainment", subCategoryId: "subscription" }),
    rule({ id: "amazon", matchType: "MERCHANT", pattern: "AMAZON", categoryId: "shopping" }),
    rule({ id: "fuel", matchType: "KEYWORD", pattern: "FUEL", categoryId: "transport", subCategoryId: "fuel" }),
    rule({ id: "salary", matchType: "KEYWORD", pattern: "SALARY", categoryId: "salary", categoryKind: "INCOME" }),
    rule({ id: "big-rent", matchType: "AMOUNT", pattern: "RENT", amountMin: 10000, categoryId: "rent", priority: 50 }),
    rule({ id: "off", matchType: "KEYWORD", pattern: "COFFEE", categoryId: "cafe", isActive: false }),
  ];
  const debit = (description: string, merchantName?: string, amount: number | string = 500) =>
    categorize({ description, merchantName, amount, direction: "DEBIT", allowedKinds: ["EXPENSE"] }, rules);

  it("applies the spec's examples", () => {
    expect(debit("SWIGGY ORDER", "Swiggy")).toMatchObject({ categoryId: "food", subCategoryId: "delivery", ruleId: "swiggy" });
    expect(debit("UPI/412345678901/ZOMATO/zomato@hdfc")).toMatchObject({ categoryId: "food", ruleId: "zomato" });
    expect(debit("UBER TRIP", "Uber India")).toMatchObject({ categoryId: "transport", subCategoryId: "taxi" });
    expect(debit("NETFLIX.COM", "Netflix")).toMatchObject({ categoryId: "entertainment", subCategoryId: "subscription" });
    expect(debit("AMAZON.IN ORDER", "Amazon")).toMatchObject({ categoryId: "shopping", subCategoryId: null });
  });

  it("supports keyword and amount rules with priority", () => {
    expect(debit("INDIAN OIL FUEL STATION")).toMatchObject({ ruleId: "fuel" });
    expect(debit("RENT FOR OCTOBER", undefined, 15000)).toMatchObject({ ruleId: "big-rent" });
    expect(debit("RENT FOR OCTOBER", undefined, 900)).toBeNull();
  });

  it("ignores inactive rules and rules of the wrong kind", () => {
    expect(debit("COFFEE DAY")).toBeNull();
    expect(debit("SALARY ADVANCE REPAYMENT")).toBeNull(); // INCOME rule never categorizes a debit
    expect(categorize({ description: "SALARY CREDIT ACME", amount: 85000, direction: "CREDIT", allowedKinds: ["INCOME"] }, rules)).toMatchObject({ ruleId: "salary" });
  });

  it("prefers the merchant's learned default", () => {
    const res = categorize({ description: "SWIGGY INSTAMART", merchantName: "Swiggy", amount: 400, direction: "DEBIT", allowedKinds: ["EXPENSE"] }, rules, {
      categoryId: "groceries", subCategoryId: null, categoryKind: "EXPENSE",
    });
    expect(res).toMatchObject({ categoryId: "groceries", source: "MERCHANT_DEFAULT" });
  });

  it("maps transaction types to category kinds", () => {
    expect(allowedKindsFor("EXPENSE", "DEBIT")).toEqual(["EXPENSE"]);
    expect(allowedKindsFor("INCOME", "CREDIT")).toEqual(["INCOME"]);
    expect(allowedKindsFor("REFUND", "CREDIT")).toEqual(["EXPENSE"]);
    expect(allowedKindsFor("CARD_PAYMENT", "DEBIT")).toEqual(["TRANSFER"]);
  });
});

describe("account balances", () => {
  it("bank balance = opening + credits − debits", () => {
    expect(accountBalance("1000.00", [
      { amount: "85000", direction: "CREDIT" },
      { amount: "15000.50", direction: "DEBIT" },
      { amount: "0.10", direction: "DEBIT" },
    ]).toFixed(2)).toBe("70999.40");
  });

  it("card outstanding: purchases add, refunds and bill payments reduce", () => {
    expect(cardOutstanding(5000, [
      { amount: 1250, direction: "DEBIT", transactionType: "EXPENSE" },
      { amount: 250, direction: "CREDIT", transactionType: "REFUND" },
      { amount: 3000, direction: "DEBIT", transactionType: "CARD_PAYMENT" },
    ]).toFixed(2)).toBe("3000.00");
  });

  it("derives the opening value needed to reconcile to a real balance", () => {
    expect(openingForTarget("184250.00", "-12345.67").toFixed(2)).toBe("196595.67");
  });
});
