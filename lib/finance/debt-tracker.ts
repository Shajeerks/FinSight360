import { Decimal, roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

/**
 * Monthly debt ledger — the same working as a lender-wise Excel sheet, done exactly.
 *
 * For every lender and calendar month:
 *
 *   Opening (total outstanding at the start of the month)
 *   + New borrowing / spends   (card purchases, a loan disbursal, money borrowed)
 *   − Payment this month       (card bill payments, EMIs, repayments)
 *   + Interest & charges       (finance charges, late fees, EMI interest)
 *   = Closing (remaining balance)
 *
 * The opening of a month is always the closing of the month before, so the chain
 * never breaks. Any figure can be entered by hand (or imported from Excel); an
 * entered closing makes interest the balancing figure:
 *
 *   Interest & charges = Closing − Opening − New borrowing + Payment
 */

export type MonthKey = string; // "YYYY-MM"

/** What FinSight360 works out on its own for one lender in one month. */
export type AutoMonth = {
  newBorrowing: Decimal;
  payment: Decimal;
  /** Interest & charges for the month, given the opening it actually started with. */
  interest: (opening: Decimal) => Decimal;
  /** A closing figure the source knows for certain (e.g. from a statement) — else null. */
  closing?: Decimal | null;
  remainingEmis: number | null;
};

/** Figures entered by hand / from Excel. null = calculate. */
export type MonthOverride = {
  openingOutstanding?: MoneyInput;
  newBorrowing?: MoneyInput;
  payment?: MoneyInput;
  paidToDate?: MoneyInput;
  interest?: MoneyInput;
  closingOutstanding?: MoneyInput;
  remainingEmis?: number | null;
};

export type DebtField = "opening" | "newBorrowing" | "payment" | "paidToDate" | "interest" | "closing" | "remainingEmis";

export type DebtMonthRow = {
  month: MonthKey;
  opening: Decimal;
  newBorrowing: Decimal;
  payment: Decimal;
  paidToDate: Decimal;
  interest: Decimal;
  closing: Decimal;
  remainingEmis: number | null;
  /** Closing − last month's closing (negative = debt went down). */
  changeFromLastMonth: Decimal;
  /** Fields that were entered by hand / imported (shown with a marker, editable). */
  entered: DebtField[];
  /** When both closing and interest were entered and they don't add up: the gap. */
  unreconciled: Decimal;
};

const has = (v: MoneyInput | undefined): v is Exclude<MoneyInput, null | undefined> => v !== null && v !== undefined && v !== "";

export function monthKey(d: Date): MonthKey {
  return d.toISOString().slice(0, 7);
}

export function monthStart(key: MonthKey): Date {
  return new Date(`${key}-01T00:00:00.000Z`);
}

export function monthEnd(key: MonthKey): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0));
}

export function nextMonth(key: MonthKey, delta = 1): MonthKey {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthKey(d);
}

export function monthsBetween(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = from; k <= to; k = nextMonth(k)) out.push(k);
  return out;
}

/**
 * Builds the month-by-month chain for one lender.
 * @param baseOpening what was owed at the start of the first month
 * @param paidBefore  total repaid before the first month (for "paid till this month")
 */
export function buildLenderMonths(
  months: MonthKey[],
  baseOpening: MoneyInput,
  paidBefore: MoneyInput,
  auto: (month: MonthKey) => AutoMonth,
  overrides: Map<MonthKey, MonthOverride> = new Map(),
): DebtMonthRow[] {
  const rows: DebtMonthRow[] = [];
  let prev: DebtMonthRow | null = null;
  for (const month of months) {
    const a = auto(month);
    const o = overrides.get(month) ?? {};
    const entered: DebtField[] = [];
    const pick = (field: DebtField, value: MoneyInput | undefined, fallback: () => Decimal) => {
      if (has(value)) {
        entered.push(field);
        return roundMoney(value);
      }
      return roundMoney(fallback());
    };

    const opening = pick("opening", o.openingOutstanding, () => (prev ? prev.closing : toDecimal(baseOpening)));
    const newBorrowing = pick("newBorrowing", o.newBorrowing, () => a.newBorrowing);
    const payment = pick("payment", o.payment, () => a.payment);

    let interest: Decimal;
    let closing: Decimal;
    let unreconciled = new Decimal(0);
    const enteredClosing = has(o.closingOutstanding) ? roundMoney(o.closingOutstanding) : null;
    const enteredInterest = has(o.interest) ? roundMoney(o.interest) : null;
    if (enteredClosing && enteredInterest) {
      closing = enteredClosing;
      interest = enteredInterest;
      entered.push("closing", "interest");
      unreconciled = roundMoney(closing.minus(opening.plus(newBorrowing).minus(payment).plus(interest)));
    } else if (enteredClosing) {
      closing = enteredClosing;
      entered.push("closing");
      interest = roundMoney(closing.minus(opening).minus(newBorrowing).plus(payment));
    } else if (enteredInterest) {
      interest = enteredInterest;
      entered.push("interest");
      closing = roundMoney(opening.plus(newBorrowing).minus(payment).plus(interest));
    } else if (a.closing) {
      // A figure from the lender's own statement beats our estimate of interest.
      closing = roundMoney(a.closing);
      interest = roundMoney(closing.minus(opening).minus(newBorrowing).plus(payment));
    } else {
      interest = roundMoney(a.interest(opening));
      closing = roundMoney(opening.plus(newBorrowing).minus(payment).plus(interest));
    }

    const paidToDate = pick("paidToDate", o.paidToDate, () => (prev ? prev.paidToDate : toDecimal(paidBefore)).plus(payment));
    let remainingEmis = a.remainingEmis;
    if (o.remainingEmis !== null && o.remainingEmis !== undefined) {
      remainingEmis = o.remainingEmis;
      entered.push("remainingEmis");
    }
    const row: DebtMonthRow = {
      month,
      opening,
      newBorrowing,
      payment,
      paidToDate,
      interest,
      closing,
      remainingEmis,
      changeFromLastMonth: roundMoney(closing.minus(prev ? prev.closing : opening)),
      entered,
      unreconciled,
    };
    rows.push(row);
    prev = row;
  }
  return rows;
}

/** A row with nothing owed and nothing happening — hidden from the monthly sheet. */
export function isEmptyRow(r: DebtMonthRow): boolean {
  return r.opening.isZero() && r.closing.isZero() && r.payment.isZero() && r.newBorrowing.isZero() && r.interest.isZero() && r.entered.length === 0;
}

/** Interest as a share of the opening balance, per month and annualised (simple ×12). */
export function effectiveRate(interest: MoneyInput, opening: MoneyInput): { monthlyPct: Decimal; annualPct: Decimal } | null {
  const o = toDecimal(opening);
  if (o.lessThanOrEqualTo(0)) return null;
  const monthly = toDecimal(interest).dividedBy(o).times(100);
  return { monthlyPct: monthly.toDecimalPlaces(2), annualPct: monthly.times(12).toDecimalPlaces(2) };
}

/** Indian financial year (April–March) a month belongs to, e.g. "2026-10" → 2026 (FY 2026-27). */
export function financialYearOf(key: MonthKey): number {
  const [y, m] = key.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
