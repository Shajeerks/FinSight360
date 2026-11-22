import "server-only";
import { prisma } from "@/lib/db";
import { Decimal, roundMoney, sum, toDecimal } from "@/lib/money";
import { DEFAULT_TIMEZONE, todayInTimezone } from "@/lib/dates";
import { financialYearOf, monthStart, monthsBetween, nextMonth } from "@/lib/finance/debt-tracker";
import { monthsToClose } from "@/lib/finance/closing-plan";
import { getDebtTrackerMonth, type DueStatus } from "@/services/debt-tracker.service";

/**
 * The one-page "Pay & Close" view for a month: what to pay and by when, what's paid,
 * what you owe and how it moved, which debts close soonest, and whether income covers it.
 * Built on the Debt Tracker (statements, loan schedules, your figures and your Excel import).
 */
export async function getPayPlan(userId: string, month: string | null | undefined, timezone = DEFAULT_TIMEZONE) {
  const d = await getDebtTrackerMonth(userId, month, timezone);
  const today = todayInTimezone(timezone);
  const DAY = 86_400_000;

  type PayItem = {
    key: string; name: string; kind: string; href: string | null; detail: string;
    dueDate: Date | null; amountDue: Decimal; paid: Decimal; left: Decimal; status: DueStatus; daysLeft: number | null; commitment: boolean;
  };
  const items: PayItem[] = [];
  const add = (x: { key: string; name: string; kind: string; href: string | null; detail: string; due: { dueDate: Date | null; amountDue: Decimal | null; paid: Decimal; status: DueStatus } | null; payment: Decimal }, commitment: boolean) => {
    const amountDue = x.due?.amountDue ?? null;
    const paid = Decimal.max(x.due?.paid ?? ZERO, x.payment);
    if ((!amountDue || amountDue.lessThanOrEqualTo(0)) && paid.lessThanOrEqualTo(0)) return;
    const due = amountDue ?? paid;
    const left = Decimal.max(due.minus(paid), 0);
    const status: DueStatus = x.due?.status ?? (left.lessThanOrEqualTo(1) ? "PAID" : "DUE");
    items.push({
      key: x.key, name: x.name, kind: x.kind, href: x.href, detail: x.detail,
      dueDate: x.due?.dueDate ?? null, amountDue: roundMoney(due), paid: roundMoney(paid), left: roundMoney(left), status,
      daysLeft: x.due?.dueDate ? Math.round((x.due.dueDate.getTime() - today.getTime()) / DAY) : null,
      commitment,
    });
  };
  const ZERO = new Decimal(0);
  for (const r of d.rows) add({ key: r.key, name: r.name, kind: r.kind, href: r.href, detail: r.detail, due: r.due, payment: r.row.payment }, false);
  for (const c of d.commitments) add({ key: c.key, name: c.name, kind: "COMMITMENT", href: null, detail: c.detail, due: c.due, payment: c.row?.payment ?? ZERO }, true);
  items.sort((a, b) => (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) || b.left.comparedTo(a.left));

  const settled = (s: DueStatus) => s === "PAID" || s === "NO_DUE";
  const totals = {
    due: roundMoney(sum(items.map((i) => i.amountDue))),
    paid: roundMoney(sum(items.map((i) => Decimal.min(i.paid, i.amountDue)))),
    left: roundMoney(sum(items.filter((i) => !settled(i.status)).map((i) => i.left))),
    overdue: items.filter((i) => i.status === "OVERDUE").length,
    dueSoon: items.filter((i) => !settled(i.status) && i.status !== "OVERDUE" && i.daysLeft !== null && i.daysLeft >= 0 && i.daysLeft <= 3).length,
    commitments: roundMoney(sum(items.filter((i) => i.commitment).map((i) => i.amountDue))),
  };

  const income = await prisma.monthIncome.findUnique({ where: { userId_month: { userId, month: monthStart(d.month) } } });
  const incomeTotal = income ? roundMoney(toDecimal(income.salary ?? 0).plus(income.otherIncome ?? 0)) : null;

  // Focus on closing: every debt still owed, with what it takes to close at today's pace.
  const closing = d.rows
    .filter((r) => r.row.closing.greaterThan(1))
    .map((r) => {
      const balance = Decimal.max(r.row.closing, 0);
      const monthly = r.due?.amountDue && r.due.amountDue.greaterThan(0) ? r.due.amountDue : r.row.payment;
      const months = monthsToClose({ key: r.key, name: r.name, balance: balance.toNumber(), monthly: monthly.toNumber(), emisLeft: r.row.remainingEmis });
      return {
        key: r.key, name: r.name, kind: r.kind, href: r.href,
        balance: roundMoney(balance), monthly: roundMoney(monthly), months, emisLeft: r.row.remainingEmis,
        closesIn: months !== null ? nextMonth(d.month, months) : null,
        rate: r.annualRatePct ?? r.rate?.annualPct ?? null,
      };
    })
    .sort((a, b) => a.balance.comparedTo(b.balance));

  // What moved vs last month (spends added, bills paid down).
  const moves = d.rows
    .filter((r) => !r.row.changeFromLastMonth.isZero())
    .map((r) => ({ key: r.key, name: r.name, change: r.row.changeFromLastMonth }))
    .sort((a, b) => b.change.comparedTo(a.change));

  const fy = financialYearOf(d.month);
  const fyMonths = monthsBetween(`${fy}-04`, d.month);
  return {
    month: d.month,
    current: d.current,
    months: d.months,
    items,
    totals,
    outstanding: { start: d.totals.opening, end: d.totals.closing, change: d.totals.change, prevClosing: d.prevClosing, interest: d.totals.interest },
    income: income ? { salary: income.salary, otherIncome: income.otherIncome, total: incomeTotal!, afterPayments: roundMoney(incomeTotal!.minus(totals.due)) } : null,
    closing,
    moves: { up: moves.filter((m) => m.change.greaterThan(0)).slice(0, 5), down: moves.filter((m) => m.change.lessThan(0)).reverse().slice(0, 5) },
    trend: d.trend.filter((t) => fyMonths.includes(t.month)),
    fy: d.fy.label,
    pendingReview: d.pendingReview,
  };
}
export type PayPlan = Awaited<ReturnType<typeof getPayPlan>>;
