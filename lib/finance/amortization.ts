import { Decimal, roundMoney, toDecimal, type MoneyInput, sum } from "@/lib/money";

export type Frequency = "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY";

export const MONTHS_PER_PERIOD: Record<Frequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

export type LoanTerms = {
  principal: MoneyInput;
  /** Annual interest rate in percent, e.g. 9.5 */
  annualRatePct: MoneyInput;
  tenureMonths: number;
  frequency?: Frequency;
  /** Date of the first instalment (UTC-midnight). */
  firstDueDate: Date;
  /** Override EMI (e.g. the lender's quoted EMI). Defaults to the computed EMI. */
  emi?: MoneyInput;
  /** Round the computed EMI to whole rupees (common for Indian lenders). */
  roundEmiToRupee?: boolean;
};

export type ScheduleRow = {
  installmentNumber: number;
  dueDate: Date;
  openingPrincipal: Decimal;
  emi: Decimal;
  principal: Decimal;
  interest: Decimal;
  closingPrincipal: Decimal;
};

function periodicRate(annualRatePct: MoneyInput, frequency: Frequency): Decimal {
  const periodsPerYear = 12 / MONTHS_PER_PERIOD[frequency];
  return toDecimal(annualRatePct).div(100).div(periodsPerYear);
}

export function numberOfInstallments(tenureMonths: number, frequency: Frequency = "MONTHLY"): number {
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) throw new Error("Tenure must be a positive whole number of months");
  const per = MONTHS_PER_PERIOD[frequency];
  if (tenureMonths % per !== 0) throw new Error(`Tenure must be a multiple of ${per} months for ${frequency} payments`);
  return tenureMonths / per;
}

/** Standard reducing-balance EMI: P·r·(1+r)^n / ((1+r)^n − 1). */
export function calculateEmi(
  principal: MoneyInput,
  annualRatePct: MoneyInput,
  tenureMonths: number,
  frequency: Frequency = "MONTHLY",
  roundToRupee = false,
): Decimal {
  const p = toDecimal(principal);
  if (p.lessThanOrEqualTo(0)) throw new Error("Principal must be greater than zero");
  if (toDecimal(annualRatePct).lessThan(0)) throw new Error("Interest rate cannot be negative");
  const n = numberOfInstallments(tenureMonths, frequency);
  const r = periodicRate(annualRatePct, frequency);
  const emi = r.isZero() ? p.div(n) : p.times(r).times(r.plus(1).pow(n)).div(r.plus(1).pow(n).minus(1));
  return roundToRupee ? emi.toDecimalPlaces(0, Decimal.ROUND_UP) : roundMoney(emi);
}

function addMonthsClamped(date: Date, months: number, anchorDay: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(anchorDay, lastDay)));
}

/**
 * Full reducing-balance amortization schedule.
 * Interest each period = round(opening × r, 2); principal = EMI − interest.
 * The final instalment clears any rounding residue so closing principal is exactly 0.
 */
export function generateAmortizationSchedule(terms: LoanTerms): ScheduleRow[] {
  const frequency = terms.frequency ?? "MONTHLY";
  const n = numberOfInstallments(terms.tenureMonths, frequency);
  const r = periodicRate(terms.annualRatePct, frequency);
  const emi = terms.emi !== undefined && terms.emi !== null
    ? roundMoney(terms.emi)
    : calculateEmi(terms.principal, terms.annualRatePct, terms.tenureMonths, frequency, terms.roundEmiToRupee);
  const step = MONTHS_PER_PERIOD[frequency];
  const anchorDay = terms.firstDueDate.getUTCDate();

  const rows: ScheduleRow[] = [];
  let opening = roundMoney(terms.principal);
  for (let i = 1; i <= n && opening.greaterThan(0); i++) {
    const interest = roundMoney(opening.times(r));
    let principal = emi.minus(interest);
    if (principal.lessThanOrEqualTo(0)) throw new Error("EMI is too small to cover interest — the loan would never be repaid");
    let instalment = emi;
    if (i === n || principal.greaterThanOrEqualTo(opening)) {
      principal = opening;
      instalment = roundMoney(principal.plus(interest));
    }
    const closing = roundMoney(opening.minus(principal));
    rows.push({
      installmentNumber: i,
      dueDate: addMonthsClamped(terms.firstDueDate, (i - 1) * step, anchorDay),
      openingPrincipal: opening,
      emi: instalment,
      principal: roundMoney(principal),
      interest,
      closingPrincipal: closing,
    });
    opening = closing;
  }
  return rows;
}

export type ScheduleSummary = {
  installments: number;
  totalPayment: Decimal;
  totalInterest: Decimal;
  totalPrincipal: Decimal;
  /** Interest ÷ principal, as a percentage. */
  interestToPrincipalPct: Decimal;
};

export function summarizeSchedule(rows: ScheduleRow[]): ScheduleSummary {
  const totalInterest = sum(rows.map((r) => r.interest));
  const totalPrincipal = sum(rows.map((r) => r.principal));
  return {
    installments: rows.length,
    totalPayment: sum(rows.map((r) => r.emi)),
    totalInterest,
    totalPrincipal,
    interestToPrincipalPct: totalPrincipal.isZero()
      ? new Decimal(0)
      : totalInterest.div(totalPrincipal).times(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  };
}

/** Interest / principal falling due within [from, to). */
export function scheduleTotalsBetween(rows: ScheduleRow[], from: Date, to: Date) {
  const inRange = rows.filter((r) => r.dueDate >= from && r.dueDate < to);
  return { interest: sum(inRange.map((r) => r.interest)), principal: sum(inRange.map((r) => r.principal)), count: inRange.length };
}

/** EMI that repays `principal` in exactly `installments` payments. */
export function emiForInstallments(principal: MoneyInput, annualRatePct: MoneyInput, installments: number, frequency: Frequency = "MONTHLY"): Decimal {
  if (!Number.isInteger(installments) || installments <= 0) throw new Error("Installments must be a positive whole number");
  return calculateEmi(principal, annualRatePct, installments * MONTHS_PER_PERIOD[frequency], frequency);
}

export type ProjectionInput = {
  /** Principal still owed. */
  outstanding: MoneyInput;
  annualRatePct: MoneyInput;
  frequency?: Frequency;
  /** EMI to keep paying (the projection finds how many instalments remain). */
  emi: MoneyInput;
  /** Due date of the next unpaid instalment. */
  nextDueDate: Date;
  /** Number to give the first projected instalment. */
  startInstallment: number;
  /** Day of month instalments fall on (defaults to nextDueDate's day). */
  anchorDay?: number;
};

/**
 * Projects the remaining schedule from the current outstanding principal while
 * keeping the EMI — used after part-payments, prepayments and missed/short EMIs.
 * Interest = round(opening × r, 2); the last instalment clears the residue.
 */
export function projectRemainingSchedule(input: ProjectionInput): ScheduleRow[] {
  const frequency = input.frequency ?? "MONTHLY";
  const r = periodicRate(input.annualRatePct, frequency);
  const emi = roundMoney(input.emi);
  const step = MONTHS_PER_PERIOD[frequency];
  const anchorDay = input.anchorDay ?? input.nextDueDate.getUTCDate();
  let opening = roundMoney(input.outstanding);
  const rows: ScheduleRow[] = [];
  let i = 0;
  while (opening.greaterThan(0)) {
    if (i >= 1200) throw new Error("Schedule would exceed 100 years — check the EMI and interest rate");
    const interest = roundMoney(opening.times(r));
    let principal = emi.minus(interest);
    if (principal.lessThanOrEqualTo(0)) throw new Error("EMI is too small to cover interest — the loan would never be repaid");
    let instalment = emi;
    // Final instalment (or a rounding residue of ≤ ₹1 left over) — clear it now,
    // like lenders do with the last-EMI adjustment.
    if (principal.greaterThanOrEqualTo(opening) || opening.minus(principal).lessThanOrEqualTo(1)) {
      principal = opening;
      instalment = roundMoney(principal.plus(interest));
    }
    const closing = roundMoney(opening.minus(principal));
    rows.push({
      installmentNumber: input.startInstallment + i,
      dueDate: addMonthsClamped(input.nextDueDate, i * step, anchorDay),
      openingPrincipal: opening,
      emi: instalment,
      principal: roundMoney(principal),
      interest,
      closingPrincipal: closing,
    });
    opening = closing;
    i++;
  }
  return rows;
}

/** Next due date after `date` on the loan's cadence. */
export function nextInstallmentDate(date: Date, frequency: Frequency = "MONTHLY", anchorDay?: number): Date {
  return addMonthsClamped(date, MONTHS_PER_PERIOD[frequency], anchorDay ?? date.getUTCDate());
}
