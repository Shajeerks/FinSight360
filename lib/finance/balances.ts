import { Decimal, roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

export type BalanceEntry = { amount: MoneyInput; direction: "DEBIT" | "CREDIT"; transactionType?: string };

/** Bank / cash: opening + credits − debits. */
export function accountBalance(opening: MoneyInput, entries: BalanceEntry[]): Decimal {
  let bal = toDecimal(opening);
  for (const e of entries) bal = e.direction === "CREDIT" ? bal.plus(toDecimal(e.amount)) : bal.minus(toDecimal(e.amount));
  return roundMoney(bal);
}

/**
 * Credit card: opening + purchases/fees (debits) − refunds (credits) − bill payments.
 * A bill payment is stored once as a CARD_PAYMENT debit on the bank account that
 * also references the card, so for the card it always reduces the outstanding.
 * Likewise a card-to-bank transfer is one BORROWING credit on the bank that also
 * references the card, so for the card it always increases the outstanding.
 */
export function cardOutstanding(opening: MoneyInput, entries: BalanceEntry[]): Decimal {
  let out = toDecimal(opening);
  for (const e of entries) {
    const amt = toDecimal(e.amount);
    if (e.transactionType === "CARD_PAYMENT") out = out.minus(amt);
    // Money taken from the card into a bank/cash account (stored once as a
    // BORROWING credit on that account that also references the card).
    else if (e.transactionType === "BORROWING") out = out.plus(amt);
    else if (e.direction === "DEBIT") out = out.plus(amt);
    else out = out.minus(amt);
  }
  return roundMoney(out);
}

/** Opening value that makes the computed balance equal `target` given the same entries. */
export function openingForTarget(target: MoneyInput, computedFromZero: MoneyInput): Decimal {
  return roundMoney(toDecimal(target).minus(toDecimal(computedFromZero)));
}

export { Decimal };
