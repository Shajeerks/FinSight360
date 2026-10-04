import { containsWord, merchantKey, normalizeDescription } from "@/lib/transactions/normalize";
import { toDecimal, type MoneyInput } from "@/lib/money";

export type CategoryKindValue = "EXPENSE" | "INCOME" | "TRANSFER";

export type RuleForMatching = {
  id: string;
  matchType: "MERCHANT" | "KEYWORD" | "AMOUNT";
  pattern?: string | null;
  amountMin?: MoneyInput;
  amountMax?: MoneyInput;
  direction?: "DEBIT" | "CREDIT" | null;
  categoryId: string;
  subCategoryId?: string | null;
  categoryKind: CategoryKindValue;
  priority: number;
  isActive: boolean;
};

export type CategorizationInput = {
  merchantName?: string | null;
  description: string;
  amount: MoneyInput;
  direction: "DEBIT" | "CREDIT";
  /** Category kinds that make sense for this transaction (e.g. INCOME for a salary credit). */
  allowedKinds: CategoryKindValue[];
};

export type CategorizationResult = {
  categoryId: string;
  subCategoryId: string | null;
  source: "MERCHANT_DEFAULT" | "RULE";
  ruleId?: string;
};

export type MerchantDefault = { categoryId: string | null; subCategoryId: string | null; categoryKind?: CategoryKindValue | null } | null;

function amountInRange(amount: MoneyInput, min: MoneyInput, max: MoneyInput): boolean {
  const a = toDecimal(amount);
  if (min !== null && min !== undefined && a.lessThan(toDecimal(min))) return false;
  if (max !== null && max !== undefined && a.greaterThan(toDecimal(max))) return false;
  return true;
}

export function ruleMatches(rule: RuleForMatching, input: CategorizationInput): boolean {
  if (!rule.isActive) return false;
  if (!input.allowedKinds.includes(rule.categoryKind)) return false;
  if (rule.direction && rule.direction !== input.direction) return false;
  const pattern = rule.pattern?.trim() ?? "";
  const merchant = merchantKey(input.merchantName);
  const desc = normalizeDescription(input.description);

  switch (rule.matchType) {
    case "MERCHANT": {
      if (!pattern) return false;
      const key = merchantKey(pattern);
      return Boolean(key) && (merchant === key || containsWord(merchant, key) || containsWord(desc, key));
    }
    case "KEYWORD":
      return Boolean(pattern) && (containsWord(desc, pattern) || containsWord(merchant, pattern));
    case "AMOUNT": {
      if (rule.amountMin == null && rule.amountMax == null) return false;
      if (!amountInRange(input.amount, rule.amountMin, rule.amountMax)) return false;
      return pattern ? containsWord(desc, pattern) || containsWord(merchant, pattern) : true;
    }
    default:
      return false;
  }
}

/**
 * Decide a category:
 *  1. the merchant's learned default ("apply to future transactions"), then
 *  2. the first matching active rule by priority (lower first; MERCHANT before KEYWORD before AMOUNT on ties).
 * Returns null when nothing matches — the transaction stays uncategorized.
 */
export function categorize(
  input: CategorizationInput,
  rules: RuleForMatching[],
  merchantDefault: MerchantDefault = null,
): CategorizationResult | null {
  if (merchantDefault?.categoryId && (!merchantDefault.categoryKind || input.allowedKinds.includes(merchantDefault.categoryKind))) {
    return { categoryId: merchantDefault.categoryId, subCategoryId: merchantDefault.subCategoryId ?? null, source: "MERCHANT_DEFAULT" };
  }
  const order = { MERCHANT: 0, KEYWORD: 1, AMOUNT: 2 } as const;
  const sorted = [...rules].sort((a, b) => a.priority - b.priority || order[a.matchType] - order[b.matchType]);
  const hit = sorted.find((r) => ruleMatches(r, input));
  return hit ? { categoryId: hit.categoryId, subCategoryId: hit.subCategoryId ?? null, source: "RULE", ruleId: hit.id } : null;
}

/** Which category kinds fit a transaction type/direction. */
export function allowedKindsFor(transactionType: string, direction: "DEBIT" | "CREDIT"): CategoryKindValue[] {
  if (transactionType === "TRANSFER" || transactionType === "CARD_PAYMENT") return ["TRANSFER"];
  if (direction === "CREDIT") {
    if (transactionType === "REFUND" || transactionType === "REVERSAL") return ["EXPENSE"];
    return ["INCOME"];
  }
  return ["EXPENSE"];
}
