import { describe, expect, it } from "vitest";
import { bestMatch, scoreDuplicate, textSimilarity, verdictFor, type DuplicateComparable } from "@/lib/duplicates/engine";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const base: DuplicateComparable = { accountRefs: ["card:hdfc"], transactionDate: d("2026-10-10"), amount: "1250.00", direction: "DEBIT", merchantName: "Amazon", description: "Amazon purchase" };

describe("duplicate detection engine", () => {
  it("ACCEPTANCE §47: Gmail 'Amazon' vs statement 'AMAZON' on the same HDFC card/date/amount is a high-confidence duplicate", () => {
    const gmail = { ...base, description: "You have spent Rs.1,250.00 at Amazon on your HDFC card" };
    const statement = { ...base, merchantName: "AMAZON", description: "AMAZON PAY INDIA BANGALORE" };
    const r = scoreDuplicate(gmail, statement);
    expect(r.score).toBeGreaterThanOrEqual(95);
    expect(verdictFor(r.score)).toBe("AUTO_MATCH");
    expect(r.matchedFields).toEqual(expect.arrayContaining(["account", "amount", "date", "merchant"]));
  });

  it("needs the same amount, direction and currency", () => {
    expect(scoreDuplicate(base, { ...base, amount: "1250.01" }).score).toBe(0);
    expect(scoreDuplicate(base, { ...base, direction: "CREDIT" }).score).toBe(0);
    expect(scoreDuplicate(base, { ...base, currency: "USD" }).score).toBe(0);
  });

  it("never matches different accounts or dates more than 3 days apart", () => {
    expect(scoreDuplicate(base, { ...base, accountRefs: ["card:icici"] }).score).toBe(0);
    expect(scoreDuplicate(base, { ...base, transactionDate: d("2026-10-14") }).score).toBe(0);
  });

  it("posting-date lag gives a 'possible duplicate' for review", () => {
    const r = scoreDuplicate(base, { ...base, transactionDate: d("2026-10-12"), merchantName: null, description: "POS AMAZON" });
    expect(verdictFor(r.score)).toBe("REVIEW");
  });

  it("matching reference numbers confirm; different ones separate", () => {
    const withRef = { ...base, merchantName: null, description: "UPI DEBIT", referenceNumber: "412345678901" };
    expect(scoreDuplicate(withRef, { ...withRef, description: "UPI/412345678901/x" }).score).toBeGreaterThanOrEqual(95);
    expect(verdictFor(scoreDuplicate(withRef, { ...withRef, referenceNumber: "999999999999" }).score)).toBe("UNIQUE");
  });

  it("treats a bank-side card bill payment and the card-side 'payment received' as the same", () => {
    const bankSide: DuplicateComparable = { accountRefs: ["bank:sal", "card:hdfc"], transactionDate: d("2026-10-04"), amount: "24500", direction: "DEBIT", description: "HDFC CREDIT CARD PAYMENT", isCardPayment: true };
    const cardSide: DuplicateComparable = { accountRefs: ["card:hdfc"], transactionDate: d("2026-10-05"), amount: "24500", direction: "CREDIT", description: "PAYMENT RECEIVED THANK YOU", isCardPayment: true };
    expect(scoreDuplicate(bankSide, cardSide).score).toBeGreaterThanOrEqual(70);
  });

  it("an unknown account on one side lowers confidence", () => {
    expect(verdictFor(scoreDuplicate(base, { ...base, accountRefs: [] }).score)).toBe("REVIEW");
  });

  it("picks the best candidate and measures text similarity", () => {
    const best = bestMatch(base, [
      { item: "far", comparable: { ...base, transactionDate: d("2026-10-13"), merchantName: "x" } },
      { item: "exact", comparable: base },
    ]);
    expect(best?.item).toBe("exact");
    expect(textSimilarity("SWIGGY ORDER BANGALORE", "swiggy order")).toBeGreaterThan(0.5);
  });
});
