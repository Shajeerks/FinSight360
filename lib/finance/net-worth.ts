import { Decimal, roundMoney, sum, type MoneyInput } from "@/lib/money";

export type NetWorthInput = {
  bankBalances: MoneyInput[];
  cashBalances?: MoneyInput[];
  investmentValues?: MoneyInput[];
  otherAssets?: MoneyInput[];
  loanOutstanding?: MoneyInput[];
  creditCardOutstanding?: MoneyInput[];
  otherLiabilities?: MoneyInput[];
};

export type NetWorth = {
  bank: Decimal;
  cash: Decimal;
  investments: Decimal;
  otherAssets: Decimal;
  totalAssets: Decimal;
  loans: Decimal;
  creditCards: Decimal;
  otherLiabilities: Decimal;
  totalLiabilities: Decimal;
  netWorth: Decimal;
};

/** Net worth = (bank + cash + investments + other assets) − (loans + card dues + other liabilities). */
export function computeNetWorth(input: NetWorthInput): NetWorth {
  const bank = sum(input.bankBalances);
  const cash = sum(input.cashBalances ?? []);
  const investments = sum(input.investmentValues ?? []);
  const otherAssets = sum(input.otherAssets ?? []);
  const loans = sum(input.loanOutstanding ?? []);
  const creditCards = sum(input.creditCardOutstanding ?? []);
  const otherLiabilities = sum(input.otherLiabilities ?? []);
  const totalAssets = bank.plus(cash).plus(investments).plus(otherAssets);
  const totalLiabilities = loans.plus(creditCards).plus(otherLiabilities);
  return {
    bank: roundMoney(bank),
    cash: roundMoney(cash),
    investments: roundMoney(investments),
    otherAssets: roundMoney(otherAssets),
    totalAssets: roundMoney(totalAssets),
    loans: roundMoney(loans),
    creditCards: roundMoney(creditCards),
    otherLiabilities: roundMoney(otherLiabilities),
    totalLiabilities: roundMoney(totalLiabilities),
    netWorth: roundMoney(totalAssets.minus(totalLiabilities)),
  };
}
