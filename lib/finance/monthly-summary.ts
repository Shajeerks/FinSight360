import { Decimal, percentOf, roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

/** Minimal ledger entry needed for monthly maths (already filtered to countable transactions). */
export type LedgerEntry = {
  amount: MoneyInput;
  direction: "DEBIT" | "CREDIT";
  transactionType:
    | "INCOME" | "EXPENSE" | "TRANSFER" | "CARD_PAYMENT" | "EMI" | "INVESTMENT"
    | "REFUND" | "REVERSAL" | "INTEREST" | "FEE" | "ATM_WITHDRAWAL" | "OTHER";
};

export type LoanSplit = { principal: MoneyInput; interest: MoneyInput };

export type MonthlySummary = {
  income: Decimal;
  expenses: Decimal;
  emi: Decimal;
  principalPaid: Decimal;
  interestPaid: Decimal;
  investments: Decimal;
  creditCardPayments: Decimal;
  /** income − expenses − EMI (money not consumed; includes what was invested) */
  savings: Decimal;
  savingsRatePct: Decimal;
  investmentRatePct: Decimal;
  /** income − expenses − EMI − investments */
  netCashFlow: Decimal;
};

/**
 * Rules (documented so totals are predictable):
 *  • Income   = CREDIT of type INCOME or INTEREST.
 *  • Expenses = DEBIT of type EXPENSE / FEE / ATM_WITHDRAWAL / OTHER
 *               minus CREDIT refunds & reversals.
 *  • EMI, INVESTMENT and CARD_PAYMENT are tracked separately and are NOT expenses
 *    (card purchases are already counted when made — counting the bill payment
 *    again would double count).
 *  • TRANSFER between own accounts is ignored.
 */
export function computeMonthlySummary(entries: LedgerEntry[], loanSplits: LoanSplit[] = []): MonthlySummary {
  let income = new Decimal(0);
  let expenses = new Decimal(0);
  let emi = new Decimal(0);
  let investments = new Decimal(0);
  let cardPayments = new Decimal(0);

  for (const e of entries) {
    const amt = toDecimal(e.amount);
    if (amt.isNegative()) throw new Error("Ledger amounts must be positive; use direction for sign");
    const { direction: d, transactionType: t } = e;
    if (d === "CREDIT" && (t === "INCOME" || t === "INTEREST")) income = income.plus(amt);
    else if (d === "DEBIT" && (t === "EXPENSE" || t === "FEE" || t === "ATM_WITHDRAWAL" || t === "OTHER")) expenses = expenses.plus(amt);
    else if (d === "CREDIT" && (t === "REFUND" || t === "REVERSAL")) expenses = expenses.minus(amt);
    else if (d === "DEBIT" && t === "EMI") emi = emi.plus(amt);
    else if (d === "DEBIT" && t === "INVESTMENT") investments = investments.plus(amt);
    else if (d === "DEBIT" && t === "CARD_PAYMENT") cardPayments = cardPayments.plus(amt);
  }

  const principalPaid = loanSplits.reduce((a, s) => a.plus(toDecimal(s.principal)), new Decimal(0));
  const interestPaid = loanSplits.reduce((a, s) => a.plus(toDecimal(s.interest)), new Decimal(0));
  const savings = income.minus(expenses).minus(emi);
  const netCashFlow = savings.minus(investments);

  return {
    income: roundMoney(income),
    expenses: roundMoney(expenses),
    emi: roundMoney(emi),
    principalPaid: roundMoney(principalPaid),
    interestPaid: roundMoney(interestPaid),
    investments: roundMoney(investments),
    creditCardPayments: roundMoney(cardPayments),
    savings: roundMoney(savings),
    savingsRatePct: percentOf(savings, income, 2),
    investmentRatePct: percentOf(investments, income, 2),
    netCashFlow: roundMoney(netCashFlow),
  };
}
