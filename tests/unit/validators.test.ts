import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema, resetPasswordSchema } from "@/validators/auth";
import { profileSchema } from "@/validators/profile";

describe("auth validators", () => {
  it("normalizes email and requires a password", () => {
    expect(loginSchema.parse({ email: "  User@Example.COM ", password: "x" }).email).toBe("user@example.com");
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("requires a strong, confirmed password on registration", () => {
    const base = { name: "Asha", email: "asha@example.com" };
    expect(registerSchema.safeParse({ ...base, password: "weakpass", confirmPassword: "weakpass" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "Strong-Pass1", confirmPassword: "Strong-Pass2" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: "Strong-Pass1", confirmPassword: "Strong-Pass1" }).success).toBe(true);
  });

  it("validates reset tokens", () => {
    expect(resetPasswordSchema.safeParse({ token: "short", password: "Strong-Pass1", confirmPassword: "Strong-Pass1" }).success).toBe(false);
  });
});

describe("profile validator", () => {
  it("accepts INR + Asia/Kolkata and bounds the alert threshold", () => {
    const ok = profileSchema.safeParse({ name: "Asha", currency: "INR", timezone: "Asia/Kolkata", cardUtilizationAlertPct: "30" });
    expect(ok.success).toBe(true);
    expect(profileSchema.safeParse({ name: "Asha", currency: "USD", timezone: "Asia/Kolkata", cardUtilizationAlertPct: 30 }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "Asha", currency: "INR", timezone: "Mars/Base", cardUtilizationAlertPct: 30 }).success).toBe(false);
    expect(profileSchema.safeParse({ name: "Asha", currency: "INR", timezone: "UTC", cardUtilizationAlertPct: 150 }).success).toBe(false);
  });
});

import { transactionSchema, parseTransactionFilters } from "@/validators/transactions";
import { creditCardSchema } from "@/validators/credit-cards";

describe("transaction validator", () => {
  const base = { kind: "EXPENSE", transactionDate: "2026-10-04", amount: "1,250.50", account: "bank:abc", description: "Lunch" };

  it("parses money and dates exactly", () => {
    const v = transactionSchema.parse(base);
    expect(v.amount).toBe("1250.50");
    expect(v.transactionDate.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("rejects bad amounts, dates and accounts", () => {
    expect(transactionSchema.safeParse({ ...base, amount: "0" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, amount: "12.345" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, transactionDate: "2026-02-30" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, account: "bank:" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "INCOME", account: "card:abc" }).success).toBe(false);
  });

  it("requires a different destination for transfers and a card for card payments", () => {
    expect(transactionSchema.safeParse({ ...base, kind: "TRANSFER", toAccount: "bank:abc" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "TRANSFER", toAccount: "card:xyz" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "TRANSFER", toAccount: "bank:xyz" }).success).toBe(true);
    expect(transactionSchema.safeParse({ ...base, kind: "CARD_PAYMENT" }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, kind: "CARD_PAYMENT", creditCardId: "card1" }).success).toBe(true);
  });

  it("drops invalid filter values instead of failing the page", () => {
    const f = parseTransactionFilters({ q: "swiggy", from: "bad-date", min: "abc", type: "EXPENSE", page: "2" });
    expect(f).toMatchObject({ q: "swiggy", type: "EXPENSE", page: 2 });
    expect(f.from).toBeUndefined();
    expect(f.min).toBeUndefined();
  });
});

describe("credit card validator", () => {
  it("only accepts the last 4 digits and a minimum due ≤ total due", () => {
    const base = { bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: "200000", currentOutstanding: "0" };
    expect(creditCardSchema.safeParse(base).success).toBe(true);
    expect(creditCardSchema.safeParse({ ...base, last4: "4111111111111111" }).success).toBe(false);
    expect(creditCardSchema.safeParse({ ...base, totalAmountDue: "100", minimumAmountDue: "200" }).success).toBe(false);
    expect(creditCardSchema.safeParse({ ...base, statementDay: "32" }).success).toBe(false);
  });
});
