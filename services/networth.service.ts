import "server-only";
import { prisma } from "@/lib/db";
import { computeNetWorth, type NetWorth } from "@/lib/finance/net-worth";
import { todayInTimezone } from "@/lib/dates";

/**
 * Net worth from current balances (bank + cash + investments − loans − card dues),
 * and its history (one snapshot per day, written by the daily job and on demand).
 */
export async function currentNetWorth(userId: string) {
  const [banks, cash, holdings, loans, cards] = await Promise.all([
    prisma.bankAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, select: { nickname: true, bankName: true, currentBalance: true } }),
    prisma.cashAccount.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, select: { name: true, currentBalance: true } }),
    prisma.investmentHolding.findMany({ where: { userId, deletedAt: null, investmentAccount: { deletedAt: null } }, select: { currentValue: true, investedAmount: true, instrumentType: true } }),
    prisma.loan.findMany({ where: { userId, deletedAt: null, status: "ACTIVE" }, select: { name: true, lender: true, outstandingPrincipal: true } }),
    prisma.creditCard.findMany({ where: { userId, deletedAt: null, status: { not: "CLOSED" } }, select: { bankName: true, cardName: true, last4: true, currentOutstanding: true } }),
  ]);
  const nw: NetWorth = computeNetWorth({
    bankBalances: banks.map((b) => b.currentBalance),
    cashBalances: cash.map((c) => c.currentBalance),
    investmentValues: holdings.map((h) => h.currentValue ?? h.investedAmount),
    loanOutstanding: loans.map((l) => l.outstandingPrincipal),
    // A card with a credit balance (overpaid) is not a liability.
    creditCardOutstanding: cards.map((c) => (c.currentOutstanding.greaterThan(0) ? c.currentOutstanding : 0)),
  });
  return {
    netWorth: nw,
    assets: [
      ...banks.map((b) => ({ group: "Bank", name: `${b.nickname} · ${b.bankName}`, amount: b.currentBalance })),
      ...cash.map((c) => ({ group: "Cash", name: c.name, amount: c.currentBalance })),
      ...(nw.investments.greaterThan(0) ? [{ group: "Investments", name: "Portfolio", amount: nw.investments }] : []),
    ],
    liabilities: [
      ...loans.map((l) => ({ group: "Loans", name: `${l.name} · ${l.lender}`, amount: l.outstandingPrincipal })),
      ...cards.filter((c) => c.currentOutstanding.greaterThan(0)).map((c) => ({ group: "Credit cards", name: `${c.bankName} ${c.cardName} ••${c.last4}`, amount: c.currentOutstanding })),
    ],
  };
}

export async function recordNetWorthSnapshot(userId: string, timezone = "Asia/Kolkata") {
  const { netWorth } = await currentNetWorth(userId);
  const snapshotDate = todayInTimezone(timezone);
  return prisma.netWorthSnapshot.upsert({
    where: { userId_snapshotDate: { userId, snapshotDate } },
    update: { totalAssets: netWorth.totalAssets, totalLiabilities: netWorth.totalLiabilities, netWorth: netWorth.netWorth },
    create: { userId, snapshotDate, totalAssets: netWorth.totalAssets, totalLiabilities: netWorth.totalLiabilities, netWorth: netWorth.netWorth },
  });
}

export async function netWorthHistory(userId: string, months = 24) {
  const since = new Date(Date.now() - months * 31 * 86_400_000);
  const rows = await prisma.netWorthSnapshot.findMany({ where: { userId, snapshotDate: { gte: since } }, orderBy: { snapshotDate: "asc" } });
  return rows.map((r) => ({ date: r.snapshotDate.toISOString().slice(0, 10), assets: r.totalAssets.toNumber(), liabilities: r.totalLiabilities.toNumber(), netWorth: r.netWorth.toNumber() }));
}

/** Daily job: one snapshot per user. */
export async function snapshotAllUsers() {
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, profile: { select: { timezone: true } } } });
  for (const u of users) await recordNetWorthSnapshot(u.id, u.profile?.timezone ?? "Asia/Kolkata");
  return users.length;
}
