import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { Decimal, roundMoney, sum, toDecimal } from "@/lib/money";
import { countableWhere } from "@/lib/transactions/countable";
import { DEFAULT_TIMEZONE, todayInTimezone } from "@/lib/dates";
import {
  buildLenderMonths,
  effectiveRate,
  financialYearOf,
  fyLabel,
  isEmptyRow,
  monthEnd,
  monthKey,
  monthStart,
  monthsBetween,
  nextMonth,
  type AutoMonth,
  type DebtMonthRow,
  type MonthKey,
  type MonthOverride,
} from "@/lib/finance/debt-tracker";
import { readDebtWorkbook } from "@/lib/import/debt-excel";
import { applyEmiSchema, debtEntrySchema, debtExcelCommitSchema, debtLenderSchema, lenderKeySchema, monthParam } from "@/validators/debt-tracker";
import { recordLoanPayment } from "@/services/loan.service";

/**
 * Debt tracker: one sheet per calendar month, one row per lender (credit cards,
 * loans and other lenders), worked out from the ledger, loan schedules and
 * uploaded statements. Figures entered by hand (or imported from Excel) are
 * stored separately in DebtMonthEntry and never change the ledger.
 */

const NO_META: RequestMeta = { ip: null, userAgent: null };
const ZERO = new Decimal(0);
const MAX_HISTORY_MONTHS = 120;

export type LenderKind = "CARD" | "LOAN" | "PERSON" | "OTHER";

export type SourceNote = { kind: "statement" | "ledger" | "schedule" | "bank-match" | "entered" | "rate"; text: string };

export type MatchedEmi = { transactionId: string; date: Date; amount: Decimal; description: string; account: string | null };

export type TrackerLender = {
  key: string;
  name: string;
  kind: LenderKind;
  detail: string;
  href: string | null;
  closed: boolean;
  months: DebtMonthRow[];
  /** Per month: where the numbers came from, EMIs found in bank statements not yet applied. */
  notes: Map<MonthKey, SourceNote[]>;
  pendingEmis: Map<MonthKey, MatchedEmi[]>;
  statementHint: Map<MonthKey, { date: Date; amount: Decimal; label: string }>;
  annualRatePct: Decimal | null;
};

// ───────────────────────────── helpers ─────────────────────────────

const STOP_WORDS = new Set(["bank", "ltd", "limited", "finance", "financial", "services", "the", "of", "india", "pvt", "private", "co", "company", "loan", "loans", "card", "credit", "housing", "capital", "nbfc", "and"]);

function keywords(...texts: (string | null | undefined)[]): string[] {
  const words = new Set<string>();
  for (const t of texts) {
    for (const w of (t ?? "").toUpperCase().split(/[^A-Z0-9]+/)) {
      if (w.length >= 3 && !STOP_WORDS.has(w.toLowerCase())) words.add(w);
    }
  }
  return [...words];
}

function containsWord(haystack: string, word: string) {
  return new RegExp(`(^|[^A-Z0-9])${word}([^A-Z0-9]|$)`).test(haystack);
}

const byMonth = <T extends { transactionDate: Date }>(rows: T[]) => {
  const m = new Map<MonthKey, T[]>();
  for (const r of rows) {
    const k = monthKey(r.transactionDate);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

function overrideOf(e: { openingOutstanding: Decimal | null; newBorrowing: Decimal | null; payment: Decimal | null; paidToDate: Decimal | null; interest: Decimal | null; closingOutstanding: Decimal | null; remainingEmis: number | null }): MonthOverride {
  return {
    openingOutstanding: e.openingOutstanding,
    newBorrowing: e.newBorrowing,
    payment: e.payment,
    paidToDate: e.paidToDate,
    interest: e.interest,
    closingOutstanding: e.closingOutstanding,
    remainingEmis: e.remainingEmis,
  };
}

const minKey = (...keys: (MonthKey | null | undefined)[]) => keys.filter((k): k is MonthKey => !!k).sort()[0];

// ───────────────────────────── the tracker ─────────────────────────────

export async function buildDebtTracker(userId: string, timezone = DEFAULT_TIMEZONE) {
  const today = todayInTimezone(timezone);
  const current = monthKey(today);
  const floor = nextMonth(current, -MAX_HISTORY_MONTHS);

  const [cards, loans, lenders, entries, cardTxns, borrowingTxns, debitCandidates, cardStatements] = await Promise.all([
    prisma.creditCard.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.loan.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        schedule: { select: { id: true, installmentNumber: true, dueDate: true } },
        payments: { where: { deletedAt: null }, select: { id: true, paymentDate: true, amount: true, interestComponent: true, chargesComponent: true, isOpening: true, scheduleId: true, transactionId: true } },
      },
    }),
    prisma.debtLender.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.debtMonthEntry.findMany({ where: { userId } }),
    prisma.transaction.findMany({
      where: countableWhere(userId, { creditCardId: { not: null } }),
      select: { id: true, creditCardId: true, transactionDate: true, amount: true, direction: true, transactionType: true },
    }),
    prisma.transaction.findMany({
      where: countableWhere(userId, { transactionType: "BORROWING", creditCardId: null }),
      select: { id: true, transactionDate: true, amount: true, direction: true, description: true, merchantName: true },
    }),
    // Money paid out of a bank/cash account that isn't yet a loan payment: possible EMIs.
    prisma.transaction.findMany({
      where: countableWhere(userId, {
        direction: "DEBIT",
        OR: [{ bankAccountId: { not: null } }, { cashAccountId: { not: null } }],
        creditCardId: null,
        transferGroupId: null,
        transactionType: { in: ["EMI", "EXPENSE", "OTHER", "TRANSFER"] },
        loanPayment: { is: null },
      }),
      select: {
        id: true, transactionDate: true, amount: true, description: true, merchantName: true, transactionType: true, loanId: true,
        bankAccount: { select: { nickname: true } }, cashAccount: { select: { name: true } },
      },
    }),
    prisma.statement.findMany({
      where: { userId, deletedAt: null, type: "CREDIT_CARD", creditCardId: { not: null }, OR: [{ totalDue: { not: null } }, { closingBalance: { not: null } }] },
      select: { creditCardId: true, statementDate: true, periodEnd: true, totalDue: true, closingBalance: true },
    }),
  ]);

  const entryMap = new Map<string, Map<MonthKey, (typeof entries)[number]>>();
  for (const e of entries) {
    const k = monthKey(e.month);
    if (!entryMap.has(e.lenderKey)) entryMap.set(e.lenderKey, new Map());
    entryMap.get(e.lenderKey)!.set(k, e);
  }
  const overridesFor = (key: string) => new Map([...(entryMap.get(key) ?? new Map()).entries()].map(([k, e]) => [k, overrideOf(e)]));
  const firstEntered = (key: string) => [...(entryMap.get(key)?.keys() ?? [])].sort()[0];

  const out: TrackerLender[] = [];

  // ── Credit cards: ledger movements per month ──
  for (const card of cards) {
    const key = `card:${card.id}`;
    const txns = cardTxns.filter((t) => t.creditCardId === card.id);
    const months = byMonth(txns);
    const start = minKey(firstEntered(key), [...months.keys()].sort()[0], monthKey(card.createdAt)) ?? current;
    const range = monthsBetween(start < floor ? floor : start, current);
    const notes = new Map<MonthKey, SourceNote[]>();
    const statementHint = new Map<MonthKey, { date: Date; amount: Decimal; label: string }>();
    for (const s of cardStatements.filter((x) => x.creditCardId === card.id)) {
      const d = s.statementDate ?? s.periodEnd;
      const amt = s.totalDue ?? s.closingBalance;
      if (d && amt) statementHint.set(monthKey(d), { date: d, amount: amt, label: "Uploaded statement" });
    }
    if (card.lastStatementDate && card.totalAmountDue.greaterThan(0)) {
      statementHint.set(monthKey(card.lastStatementDate), { date: card.lastStatementDate, amount: card.totalAmountDue, label: "Statement on the card" });
    }
    const auto = (m: MonthKey): AutoMonth => {
      let spends = ZERO, payment = ZERO, charges = ZERO;
      for (const t of months.get(m) ?? []) {
        const amt = toDecimal(t.amount);
        if (t.transactionType === "CARD_PAYMENT") payment = payment.plus(amt);
        else if (t.transactionType === "BORROWING") spends = spends.plus(amt);
        else if (t.direction === "DEBIT" && (t.transactionType === "FEE" || t.transactionType === "INTEREST")) charges = charges.plus(amt);
        else if (t.direction === "DEBIT") spends = spends.plus(amt);
        else spends = spends.minus(amt); // refunds / reversals
      }
      const n: SourceNote[] = [];
      if (months.get(m)?.length) n.push({ kind: "ledger", text: `${months.get(m)!.length} card transaction(s) in FinSight360` });
      else n.push({ kind: "ledger", text: "No card transactions this month — upload the card statement, or enter the closing balance from it." });
      notes.set(m, n);
      return { newBorrowing: spends, payment, interest: () => charges, remainingEmis: null };
    };
    // Outstanding before the first month shown = opening + everything before it.
    const before = txns.filter((t) => monthKey(t.transactionDate) < range[0]);
    const baseOpening = before.reduce((acc, t) => {
      const amt = toDecimal(t.amount);
      if (t.transactionType === "CARD_PAYMENT") return acc.minus(amt);
      if (t.transactionType === "BORROWING" || t.direction === "DEBIT") return acc.plus(amt);
      return acc.minus(amt);
    }, toDecimal(card.openingOutstanding));
    const paidBefore = sum(before.filter((t) => t.transactionType === "CARD_PAYMENT").map((t) => t.amount));
    out.push({
      key,
      name: `${card.bankName} ${card.cardName}`.trim(),
      kind: "CARD",
      detail: `Credit card ••${card.last4}`,
      href: `/credit-cards`,
      closed: card.status === "CLOSED",
      months: buildLenderMonths(range, baseOpening, paidBefore, auto, overridesFor(key)),
      notes,
      pendingEmis: new Map(),
      statementHint,
      annualRatePct: null,
    });
  }

  // ── Loans: payments recorded on the loan + EMIs found in bank statements ──
  const claimed = new Set<string>();
  const loanMatches = new Map<string, MatchedEmi[]>();
  // Match debits to loans: exact EMI amount (±₹1) with an EMI label or the lender's name, or the lender's name on an EMI.
  const activeLoans = loans.filter((l) => l.status === "ACTIVE" || l.payments.some((p) => !p.isOpening));
  for (const pass of ["amount+name", "amount+emi", "name+emi"] as const) {
    for (const loan of activeLoans) {
      const words = keywords(loan.lender, loan.accountLast4);
      const lastOpening = loan.payments.filter((p) => p.isOpening).reduce<Date | null>((a, p) => (!a || p.paymentDate > a ? p.paymentDate : a), null);
      const earliest = new Date(loan.firstEmiDate.getTime() - 10 * 86400000);
      for (const t of debitCandidates) {
        if (claimed.has(t.id) || (t.loanId && t.loanId !== loan.id)) continue;
        if (t.transactionDate < earliest || (lastOpening && t.transactionDate <= lastOpening)) continue;
        if (loan.closureDate && t.transactionDate > loan.closureDate) continue;
        const hay = `${t.description} ${t.merchantName ?? ""}`.toUpperCase();
        const nameHit = words.some((w) => containsWord(hay, w));
        const amountHit = toDecimal(t.amount).minus(loan.emiAmount).abs().lessThanOrEqualTo(1);
        const isEmi = t.transactionType === "EMI" || /\bEMI\b|\bLOAN\b|\bNACH\b|\bECS\b|\bACH\b/.test(hay);
        const ok = pass === "amount+name" ? amountHit && nameHit : pass === "amount+emi" ? amountHit && isEmi && t.transactionType === "EMI" : nameHit && t.transactionType === "EMI";
        if (!ok && t.loanId !== loan.id) continue;
        // Already recorded on the loan by hand (same amount within 3 days)? Then it's that payment.
        const recorded = loan.payments.some((p) => !p.isOpening && p.transactionId && Math.abs(p.paymentDate.getTime() - t.transactionDate.getTime()) <= 3 * 86400000 && toDecimal(p.amount).equals(t.amount));
        if (recorded) continue;
        claimed.add(t.id);
        const list = loanMatches.get(loan.id) ?? [];
        list.push({ transactionId: t.id, date: t.transactionDate, amount: toDecimal(t.amount), description: t.description, account: t.bankAccount?.nickname ?? t.cashAccount?.name ?? null });
        loanMatches.set(loan.id, list);
      }
    }
  }

  for (const loan of loans) {
    const key = `loan:${loan.id}`;
    const matched = (loanMatches.get(loan.id) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
    const paymentsByMonth = new Map<MonthKey, typeof loan.payments>();
    for (const p of loan.payments) {
      const k = monthKey(p.paymentDate);
      paymentsByMonth.set(k, [...(paymentsByMonth.get(k) ?? []), p]);
    }
    const matchedByMonth = new Map<MonthKey, MatchedEmi[]>();
    for (const m of matched) {
      const k = monthKey(m.date);
      matchedByMonth.set(k, [...(matchedByMonth.get(k) ?? []), m]);
    }
    const dueMonths = new Set(loan.schedule.map((r) => monthKey(r.dueDate)));
    const firstPaidOn = new Map<string, Date>();
    for (const p of loan.payments) {
      if (!p.scheduleId) continue;
      const cur = firstPaidOn.get(p.scheduleId);
      if (!cur || p.paymentDate < cur) firstPaidOn.set(p.scheduleId, p.paymentDate);
    }
    const disbursed = monthKey(loan.startDate);
    const start = minKey(firstEntered(key), disbursed) ?? current;
    const range = monthsBetween(start < floor ? floor : start, current);
    const monthlyRate = toDecimal(loan.interestRate).dividedBy(1200);
    const closedFrom = loan.status !== "ACTIVE" && loan.closureDate ? monthKey(loan.closureDate) : null;
    const notes = new Map<MonthKey, SourceNote[]>();
    let matchedSoFar = 0;

    const auto = (m: MonthKey): AutoMonth => {
      const paid = paymentsByMonth.get(m) ?? [];
      const bank = matchedByMonth.get(m) ?? [];
      matchedSoFar += bank.length;
      const end = monthEnd(m);
      const paidRows = loan.schedule.filter((r) => {
        const d = firstPaidOn.get(r.id);
        return d && d <= end;
      }).length;
      const remaining = closedFrom && m >= closedFrom ? 0 : Math.max(loan.schedule.length - paidRows - matchedSoFar, 0);
      const recordedInterest = sum(paid.map((p) => toDecimal(p.interestComponent).plus(p.chargesComponent)));
      const payment = sum([...paid.map((p) => p.amount), ...bank.map((b) => b.amount)]);
      const n: SourceNote[] = [];
      if (paid.length) n.push({ kind: "schedule", text: `${paid.length} payment(s) recorded on the loan${paid.some((p) => p.isOpening) ? " (incl. paid before FinSight360)" : ""}` });
      if (bank.length) n.push({ kind: "bank-match", text: `${bank.length} EMI debit(s) found in your bank statement — interest estimated at ${toDecimal(loan.interestRate).toFixed(2)}% a year until applied to the loan` });
      notes.set(m, n);
      return {
        newBorrowing: m === disbursed ? toDecimal(loan.originalPrincipal) : ZERO,
        payment,
        interest: (opening) => {
          if (opening.lessThanOrEqualTo(0)) return recordedInterest;
          // Interest the lender charges this month: from recorded payments, or
          // one month on the opening balance for a due / bank-found EMI.
          if (paid.length && !bank.length) return recordedInterest;
          if (bank.length || (dueMonths.has(m) && !(closedFrom && m >= closedFrom))) return recordedInterest.plus(roundMoney(opening.times(monthlyRate)));
          return recordedInterest;
        },
        remainingEmis: remaining,
      };
    };
    const pendingEmis = new Map<MonthKey, MatchedEmi[]>();
    for (const [k, v] of matchedByMonth) pendingEmis.set(k, v);
    out.push({
      key,
      name: loan.lender === loan.name ? loan.name : `${loan.lender} — ${loan.name}`,
      kind: "LOAN",
      detail: `${loan.loanType.charAt(0)}${loan.loanType.slice(1).toLowerCase()} loan · EMI ₹${toDecimal(loan.emiAmount).toFixed(0)} · ${toDecimal(loan.interestRate).toFixed(2)}%`,
      href: `/loans/${loan.id}`,
      closed: loan.status !== "ACTIVE",
      months: buildLenderMonths(range, ZERO, ZERO, auto, overridesFor(key)),
      notes,
      pendingEmis,
      statementHint: new Map(),
      annualRatePct: toDecimal(loan.interestRate),
    });
  }

  // ── Other lenders (people etc.): "Loan / borrowing" transactions that mention them ──
  for (const l of lenders) {
    const key = `lender:${l.id}`;
    const needle = (l.matchText ?? l.name).toUpperCase().replace(/\s+/g, " ").trim();
    const txns = needle.length >= 3 ? borrowingTxns.filter((t) => `${t.description} ${t.merchantName ?? ""}`.toUpperCase().replace(/\s+/g, " ").includes(needle)) : [];
    const months = byMonth(txns);
    const startDate = l.openingDate ?? l.createdAt;
    const start = minKey(firstEntered(key), [...months.keys()].sort()[0], monthKey(startDate)) ?? current;
    const end = l.closedAt && monthKey(l.closedAt) < current ? monthKey(l.closedAt) : current;
    const range = monthsBetween(start < floor ? floor : start, end < start ? start : end);
    const rate = toDecimal(l.monthlyRatePct).dividedBy(100);
    const notes = new Map<MonthKey, SourceNote[]>();
    const auto = (m: MonthKey): AutoMonth => {
      let borrowed = ZERO, repaid = ZERO;
      for (const t of months.get(m) ?? []) {
        if (t.direction === "CREDIT") borrowed = borrowed.plus(t.amount);
        else repaid = repaid.plus(t.amount);
      }
      const n: SourceNote[] = [];
      if (months.get(m)?.length) n.push({ kind: "ledger", text: `${months.get(m)!.length} "Loan / borrowing" transaction(s) mentioning “${l.matchText ?? l.name}”` });
      if (rate.greaterThan(0)) n.push({ kind: "rate", text: `Interest at ${toDecimal(l.monthlyRatePct).toFixed(2)}% a month on the opening balance` });
      notes.set(m, n);
      return { newBorrowing: borrowed, payment: repaid, interest: (o) => (o.greaterThan(0) ? roundMoney(o.times(rate)) : ZERO), remainingEmis: null };
    };
    const before = txns.filter((t) => monthKey(t.transactionDate) < range[0]);
    const baseOpening = before.reduce((a, t) => (t.direction === "CREDIT" ? a.plus(t.amount) : a.minus(t.amount)), toDecimal(l.openingOutstanding));
    out.push({
      key,
      name: l.name,
      kind: l.kind,
      detail: l.kind === "PERSON" ? "Borrowed from a person" : "Other lender",
      href: null,
      closed: Boolean(l.closedAt),
      months: buildLenderMonths(range, baseOpening, 0, auto, overridesFor(key)),
      notes,
      pendingEmis: new Map(),
      statementHint: new Map(),
      annualRatePct: toDecimal(l.monthlyRatePct).times(12),
    });
  }

  // Lenders in entries whose card/loan/lender was deleted are dropped (their entries stay, harmless).
  const firstMonth = out.flatMap((l) => l.months.filter((r) => !isEmptyRow(r)).map((r) => r.month)).sort()[0] ?? current;

  // Debits that look like EMIs but match no loan — to apply by hand.
  const unmatchedEmis = debitCandidates
    .filter((t) => !claimed.has(t.id) && !t.loanId && t.transactionType === "EMI")
    .map((t) => ({ transactionId: t.id, date: t.transactionDate, amount: toDecimal(t.amount), description: t.description, account: t.bankAccount?.nickname ?? t.cashAccount?.name ?? null }));

  return { current, firstMonth, lenders: out, unmatchedEmis, loans: loans.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.id, label: `${l.lender} — ${l.name}`, emi: toDecimal(l.emiAmount) })) };
}

export type DebtTracker = Awaited<ReturnType<typeof buildDebtTracker>>;

/** The monthly sheet for one month, with totals, trends and the financial-year summary. */
export async function getDebtTrackerMonth(userId: string, month: string | null | undefined, timezone = DEFAULT_TIMEZONE) {
  const t = await buildDebtTracker(userId, timezone);
  const m = month && monthParam.safeParse(month).success ? (month > t.current ? t.current : month) : t.current;
  const selected = m < t.firstMonth ? t.firstMonth : m;
  const prevKey = nextMonth(selected, -1);

  const rows = t.lenders
    .map((l) => {
      const row = l.months.find((r) => r.month === selected);
      if (!row || isEmptyRow(row)) return null;
      return {
        key: l.key,
        name: l.name,
        kind: l.kind,
        detail: l.detail,
        href: l.href,
        closed: l.closed,
        row,
        notes: l.notes.get(selected) ?? [],
        pendingEmis: l.pendingEmis.get(selected) ?? [],
        statementHint: l.statementHint.get(selected) ?? null,
        rate: effectiveRate(row.interest, row.opening),
        annualRatePct: l.annualRatePct,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => ["LOAN", "CARD", "PERSON", "OTHER"].indexOf(a.kind) - ["LOAN", "CARD", "PERSON", "OTHER"].indexOf(b.kind) || b.row.closing.comparedTo(a.row.closing));

  const total = (pick: (r: DebtMonthRow) => Decimal) => roundMoney(sum(rows.map((r) => pick(r.row))));
  const totals = {
    opening: total((r) => r.opening),
    newBorrowing: total((r) => r.newBorrowing),
    payment: total((r) => r.payment),
    paidToDate: total((r) => r.paidToDate),
    interest: total((r) => r.interest),
    closing: total((r) => r.closing),
    change: total((r) => r.changeFromLastMonth),
    remainingEmis: rows.reduce((a, r) => a + (r.row.remainingEmis ?? 0), 0),
  };

  // Trend: last 12 months up to the selected one, all lenders together.
  const trendMonths = monthsBetween(nextMonth(selected, -11) < t.firstMonth ? t.firstMonth : nextMonth(selected, -11), selected);
  const trend = trendMonths.map((k) => {
    let closing = ZERO, interest = ZERO, payment = ZERO, principal = ZERO;
    for (const l of t.lenders) {
      const r = l.months.find((x) => x.month === k);
      if (!r) continue;
      closing = closing.plus(r.closing);
      interest = interest.plus(r.interest);
      payment = payment.plus(r.payment);
      principal = principal.plus(Decimal.max(r.payment.minus(r.interest), 0));
    }
    return { month: k, closing: roundMoney(closing), interest: roundMoney(interest), payment: roundMoney(payment), principal: roundMoney(principal) };
  });

  // Financial year (April–March) of the selected month: interest by lender and by loan type.
  const fy = financialYearOf(selected);
  const fyMonths = monthsBetween(`${fy}-04`, selected);
  const fyByLender = t.lenders
    .map((l) => {
      const ms = l.months.filter((r) => fyMonths.includes(r.month));
      return { key: l.key, name: l.name, kind: l.kind, interest: roundMoney(sum(ms.map((r) => r.interest))), payment: roundMoney(sum(ms.map((r) => r.payment))) };
    })
    .filter((x) => !x.interest.isZero() || !x.payment.isZero())
    .sort((a, b) => b.interest.comparedTo(a.interest));
  const loanTypes = await prisma.loan.findMany({ where: { userId, deletedAt: null }, select: { id: true, loanType: true } });
  const typeOf = new Map(loanTypes.map((l) => [`loan:${l.id}`, l.loanType]));
  const fyByType = new Map<string, { interest: Decimal; principal: Decimal }>();
  for (const l of t.lenders) {
    const group = l.kind === "LOAN" ? `${typeOf.get(l.key) ?? "OTHER"}` : l.kind;
    for (const r of l.months.filter((x) => fyMonths.includes(x.month))) {
      const g = fyByType.get(group) ?? { interest: ZERO, principal: ZERO };
      g.interest = g.interest.plus(r.interest);
      g.principal = g.principal.plus(Decimal.max(r.payment.minus(r.interest), 0));
      fyByType.set(group, g);
    }
  }

  const prevRows = t.lenders.map((l) => l.months.find((r) => r.month === prevKey)).filter(Boolean) as DebtMonthRow[];
  const prevClosing = roundMoney(sum(prevRows.map((r) => r.closing)));
  const months = monthsBetween(t.firstMonth, t.current).reverse();

  return {
    month: selected,
    current: t.current,
    months,
    rows,
    totals,
    prevClosing,
    trend,
    fy: {
      label: fyLabel(fy),
      interest: roundMoney(sum(fyByLender.map((x) => x.interest))),
      payment: roundMoney(sum(fyByLender.map((x) => x.payment))),
      byLender: fyByLender,
      byType: [...fyByType.entries()].map(([type, v]) => ({ type, interest: roundMoney(v.interest), principal: roundMoney(v.principal) })).filter((x) => !x.interest.isZero() || !x.principal.isZero()),
    },
    unmatchedEmis: t.unmatchedEmis.filter((e) => monthKey(e.date) === selected),
    loans: t.loans,
    unassignedCardPayments: await prisma.transaction.findMany({
      where: countableWhere(userId, { transactionType: "CARD_PAYMENT", creditCardId: null, transactionDate: { gte: monthStart(selected), lte: monthEnd(selected) } }),
      select: { id: true, transactionDate: true, amount: true, description: true },
      orderBy: { transactionDate: "asc" },
    }),
  };
}

export type DebtTrackerMonth = Awaited<ReturnType<typeof getDebtTrackerMonth>>;

// ───────────────────────────── entered figures ─────────────────────────────

async function lenderName(db: Prisma.TransactionClient | typeof prisma, userId: string, key: string): Promise<string> {
  const [kind, id] = key.split(":");
  if (kind === "card") {
    const c = await db.creditCard.findFirst({ where: { id, userId, deletedAt: null }, select: { bankName: true, cardName: true } });
    if (c) return `${c.bankName} ${c.cardName}`.trim();
  } else if (kind === "loan") {
    const l = await db.loan.findFirst({ where: { id, userId, deletedAt: null }, select: { lender: true, name: true } });
    if (l) return l.lender === l.name ? l.name : `${l.lender} — ${l.name}`;
  } else if (kind === "lender") {
    const l = await db.debtLender.findFirst({ where: { id, userId, deletedAt: null }, select: { name: true } });
    if (l) return l.name;
  }
  throw new NotFoundError("Lender not found.");
}

/** Save (or clear) the figures entered for one lender in one month. */
export async function saveDebtEntry(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(debtEntrySchema, input);
  const name = await lenderName(prisma, userId, d.lenderKey);
  const month = monthStart(d.month);
  const values = {
    openingOutstanding: d.openingOutstanding === null ? null : toDecimal(d.openingOutstanding),
    newBorrowing: d.newBorrowing === null ? null : toDecimal(d.newBorrowing),
    payment: d.payment === null ? null : toDecimal(d.payment),
    paidToDate: d.paidToDate === null ? null : toDecimal(d.paidToDate),
    interest: d.interest === null ? null : toDecimal(d.interest),
    closingOutstanding: d.closingOutstanding === null ? null : toDecimal(d.closingOutstanding),
    remainingEmis: d.remainingEmis,
    notes: d.notes,
  };
  const empty = Object.values(values).every((v) => v === null);
  if (empty) {
    await prisma.debtMonthEntry.deleteMany({ where: { userId, month, lenderKey: d.lenderKey } });
  } else {
    await prisma.debtMonthEntry.upsert({
      where: { userId_month_lenderKey: { userId, month, lenderKey: d.lenderKey } },
      update: { ...values, lenderName: name, source: "MANUAL" },
      create: { userId, month, lenderKey: d.lenderKey, lenderName: name, ...values, source: "MANUAL" },
    });
  }
  await audit({ userId, action: AuditAction.DEBT_ENTRY_SAVED, entityType: "DebtMonthEntry", entityId: d.lenderKey, ip: meta.ip, userAgent: meta.userAgent, metadata: { month: d.month, cleared: empty } });
}

export async function getDebtEntry(userId: string, month: string, lenderKey: string) {
  if (!monthParam.safeParse(month).success || !lenderKeySchema.safeParse(lenderKey).success) throw new AppError("Invalid month or lender.", 400, "INVALID");
  return prisma.debtMonthEntry.findUnique({ where: { userId_month_lenderKey: { userId, month: monthStart(month), lenderKey } } });
}

// ───────────────────────────── other lenders ─────────────────────────────

export async function listDebtLenders(userId: string) {
  return prisma.debtLender.findMany({ where: { userId, deletedAt: null }, orderBy: { name: "asc" } });
}

function lenderData(d: ReturnType<typeof debtLenderSchema.parse>) {
  return {
    name: d.name,
    kind: d.kind,
    matchText: d.matchText,
    openingOutstanding: roundMoney(d.openingOutstanding),
    openingDate: d.openingDate,
    monthlyRatePct: new Decimal(d.monthlyRatePct),
    notes: d.notes,
  };
}

export async function createDebtLender(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(debtLenderSchema, input);
  const l = await prisma.debtLender.create({ data: { userId, ...lenderData(d), closedAt: d.closed ? new Date() : null } });
  await audit({ userId, action: AuditAction.DEBT_LENDER_SAVED, entityType: "DebtLender", entityId: l.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { created: true } });
  return l;
}

export async function updateDebtLender(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(debtLenderSchema, input);
  const existing = await prisma.debtLender.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) throw new NotFoundError("Lender not found.");
  const l = await prisma.debtLender.update({ where: { id }, data: { ...lenderData(d), closedAt: d.closed ? (existing.closedAt ?? todayInTimezone(DEFAULT_TIMEZONE)) : null } });
  await prisma.debtMonthEntry.updateMany({ where: { userId, lenderKey: `lender:${id}` }, data: { lenderName: d.name } });
  await audit({ userId, action: AuditAction.DEBT_LENDER_SAVED, entityType: "DebtLender", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return l;
}

export async function deleteDebtLender(userId: string, id: string, meta: RequestMeta = NO_META) {
  const existing = await prisma.debtLender.findFirst({ where: { id, userId, deletedAt: null } });
  if (!existing) throw new NotFoundError("Lender not found.");
  await prisma.$transaction([
    prisma.debtLender.update({ where: { id }, data: { deletedAt: new Date() } }),
    prisma.debtMonthEntry.deleteMany({ where: { userId, lenderKey: `lender:${id}` } }),
  ]);
  await audit({ userId, action: AuditAction.DEBT_LENDER_DELETED, entityType: "DebtLender", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

// ───────────────────────────── EMIs from bank statements ─────────────────────────────

/** Turn an EMI debit from a bank statement into a payment on the loan (schedule and interest update). */
export async function applyEmiToLoan(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(applyEmiSchema, input);
  return recordLoanPayment(userId, d.loanId, { paymentType: "EMI", paymentDate: "2000-01-01", amount: "1", recordInLedger: false }, meta, { linkTransactionId: d.transactionId });
}

/** Apply every EMI matched to a loan in this month (oldest first). */
export async function applyMatchedEmis(userId: string, month: string, meta: RequestMeta = NO_META) {
  if (!monthParam.safeParse(month).success) throw new AppError("Invalid month.", 400, "INVALID");
  const t = await buildDebtTracker(userId);
  let applied = 0;
  const failed: string[] = [];
  for (const l of t.lenders.filter((x) => x.kind === "LOAN")) {
    for (const e of (l.pendingEmis.get(month) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime())) {
      try {
        await applyEmiToLoan(userId, { loanId: l.key.slice(5), transactionId: e.transactionId }, meta);
        applied++;
      } catch (err) {
        failed.push(`${l.name}: ${(err as Error).message}`);
      }
    }
  }
  return { applied, failed };
}

// ───────────────────────────── Excel history ─────────────────────────────

function normalise(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Read the workbook and suggest which lender each Excel name is. Nothing is saved. */
export async function previewDebtExcel(userId: string, buffer: Buffer) {
  let parsed;
  try {
    parsed = await readDebtWorkbook(buffer);
  } catch {
    throw new AppError("This doesn't look like an Excel (.xlsx) file. Save it as .xlsx and try again.", 400, "BAD_FILE");
  }
  if (!parsed.rows.length) {
    throw new AppError("No lender rows were found. The sheet needs a lender name column and amount columns such as Total outstanding / Remaining balance.", 400, "NO_ROWS");
  }
  const [cards, loans, lenders] = await Promise.all([
    prisma.creditCard.findMany({ where: { userId, deletedAt: null }, select: { id: true, bankName: true, cardName: true, last4: true } }),
    prisma.loan.findMany({ where: { userId, deletedAt: null }, select: { id: true, lender: true, name: true, accountLast4: true } }),
    prisma.debtLender.findMany({ where: { userId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const options = [
    ...loans.map((l) => ({ value: `loan:${l.id}`, label: `Loan · ${l.lender === l.name ? l.name : `${l.lender} — ${l.name}`}`, words: keywords(l.lender, l.name, l.accountLast4), full: normalise(`${l.lender} ${l.name}`) })),
    ...cards.map((c) => ({ value: `card:${c.id}`, label: `Card · ${c.bankName} ${c.cardName} ••${c.last4}`, words: keywords(c.bankName, c.cardName, c.last4), full: normalise(`${c.bankName} ${c.cardName}`) })),
    ...lenders.map((l) => ({ value: `lender:${l.id}`, label: `Other · ${l.name}`, words: keywords(l.name), full: normalise(l.name) })),
  ];
  const suggestions: Record<string, string> = {};
  for (const name of parsed.lenders) {
    const n = normalise(name);
    const words = keywords(name);
    let best: { value: string; score: number } | null = null;
    for (const o of options) {
      let score = o.full === n ? 100 : 0;
      const hits = words.filter((w) => o.words.includes(w)).length;
      score = Math.max(score, hits ? (hits / Math.max(words.length, 1)) * 60 + hits * 10 : 0);
      if (score > (best?.score ?? 0)) best = { value: o.value, score };
    }
    suggestions[name] = best && best.score >= 30 ? best.value : "new";
  }
  return { ...parsed, options: options.map(({ value, label }) => ({ value, label })), suggestions };
}

export async function commitDebtExcel(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(debtExcelCommitSchema, input);
  return prisma.$transaction(async (tx) => {
    const resolved = new Map<string, { key: string; name: string } | null>();
    let lendersCreated = 0;
    for (const name of new Set(d.rows.map((r) => r.lender))) {
      const target = d.mapping[name] ?? "skip";
      if (target === "skip") resolved.set(name, null);
      else if (target === "new") {
        const l = await tx.debtLender.create({ data: { userId, name: name.slice(0, 80), kind: "OTHER", notes: "Added from Excel import" } });
        lendersCreated++;
        resolved.set(name, { key: `lender:${l.id}`, name: l.name });
      } else {
        resolved.set(name, { key: target, name: await lenderName(tx, userId, target) });
      }
    }
    let saved = 0, skipped = 0, kept = 0;
    for (const r of d.rows) {
      const target = resolved.get(r.lender);
      if (!target) {
        skipped++;
        continue;
      }
      const month = monthStart(r.month);
      const where = { userId_month_lenderKey: { userId, month, lenderKey: target.key } };
      const existing = await tx.debtMonthEntry.findUnique({ where });
      if (existing && !d.overwrite) {
        kept++;
        continue;
      }
      const values = {
        lenderName: target.name,
        openingOutstanding: r.openingOutstanding === null ? null : toDecimal(r.openingOutstanding),
        payment: r.payment === null ? null : toDecimal(r.payment),
        paidToDate: r.paidToDate === null ? null : toDecimal(r.paidToDate),
        closingOutstanding: r.closingOutstanding === null ? null : toDecimal(r.closingOutstanding),
        interest: r.interest === null ? null : toDecimal(r.interest),
        remainingEmis: r.remainingEmis,
        newBorrowing: null,
        source: "EXCEL" as const,
        notes: `From Excel (${r.lender})`,
      };
      await tx.debtMonthEntry.upsert({ where, update: values, create: { userId, month, lenderKey: target.key, ...values } });
      saved++;
    }
    await audit({ userId, action: AuditAction.DEBT_EXCEL_IMPORTED, entityType: "DebtMonthEntry", ip: meta.ip, userAgent: meta.userAgent, metadata: { saved, skipped, kept, lendersCreated } }, tx);
    return { saved, skipped, kept, lendersCreated };
  });
}

/** Remove everything imported from Excel (your hand-entered figures stay). */
export async function undoDebtExcel(userId: string, meta: RequestMeta = NO_META) {
  const res = await prisma.debtMonthEntry.deleteMany({ where: { userId, source: "EXCEL" } });
  await audit({ userId, action: AuditAction.DEBT_EXCEL_IMPORTED, entityType: "DebtMonthEntry", ip: meta.ip, userAgent: meta.userAgent, metadata: { removed: res.count } });
  return res.count;
}
