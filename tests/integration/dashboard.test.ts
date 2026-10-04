import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getDashboardData } from "@/services/dashboard.service";
import { resetDatabase } from "./helpers";

const D = (v: number | string) => new Prisma.Decimal(v);
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("dashboard totals (integration, ACCEPTANCE §50)", () => {
  let userId: string;

  beforeAll(async () => {
    await resetDatabase();

    const user = await prisma.user.create({ data: { email: "dash@example.com", name: "Dash" } });
    userId = user.id;
    await prisma.userProfile.create({ data: { userId } });
    const bank = await prisma.bankAccount.create({ data: { userId, bankName: "HDFC Bank", nickname: "Salary", currentBalance: D(100000) } });
    const card = await prisma.creditCard.create({ data: { userId, bankName: "HDFC", cardName: "Regalia", last4: "1043", creditLimit: D(200000), currentOutstanding: D(50000), totalAmountDue: D(20000), currentDueDate: day("2026-10-05") } });
    await prisma.loan.create({
      data: { userId, name: "Car", lender: "HDFC", loanType: "CAR", originalPrincipal: D(500000), interestRate: D("9.5"), startDate: day("2025-01-01"), firstEmiDate: day("2025-02-07"), tenureMonths: 60, emiAmount: D(18500), emiDueDay: 7, outstandingPrincipal: D(350000) },
    });
    const holdingAcct = await prisma.investmentAccount.create({ data: { userId, name: "Groww" } });
    await prisma.investmentHolding.create({ data: { userId, investmentAccountId: holdingAcct.id, instrumentName: "Index Fund", instrumentType: "MUTUAL_FUND", instrumentKey: "IDX", quantity: D(100), averageBuyPrice: D(100), investedAmount: D(10000), currentValue: D(12000) } });

    const t = (date: string, amount: number, direction: "DEBIT" | "CREDIT", transactionType: Prisma.TransactionCreateManyInput["transactionType"], extra: Partial<Prisma.TransactionCreateManyInput> = {}) => ({
      userId, bankAccountId: bank.id, transactionDate: day(date), amount: D(amount), direction, transactionType, description: `${transactionType} ${amount}`, normalizedDescription: `${transactionType} ${amount}`, ...extra,
    });

    await prisma.transaction.createMany({
      data: [
        t("2026-09-01", 85000, "CREDIT", "INCOME"),
        t("2026-09-02", 15000, "DEBIT", "EXPENSE"),
        t("2026-09-10", 26100, "DEBIT", "EXPENSE", { creditCardId: card.id, bankAccountId: null }),
        t("2026-09-11", 1250, "DEBIT", "EXPENSE", { creditCardId: card.id, bankAccountId: null, referenceNumber: "AMZ1" }),
        t("2026-09-07", 18500, "DEBIT", "EMI"),
        t("2026-09-10", 10000, "DEBIT", "INVESTMENT"),
        t("2026-09-15", 20000, "DEBIT", "CARD_PAYMENT"),
        // Must NOT count: pending review, rejected, soft-deleted, and other months
        t("2026-09-12", 999, "DEBIT", "EXPENSE", { status: "PENDING_REVIEW" }),
        t("2026-09-12", 888, "DEBIT", "EXPENSE", { status: "REJECTED" }),
        t("2026-09-12", 777, "DEBIT", "EXPENSE", { deletedAt: new Date() }),
        t("2026-08-31", 5000, "DEBIT", "EXPENSE"),
        t("2026-10-01", 5000, "DEBIT", "EXPENSE"),
      ],
    });
    // A confirmed duplicate of the ₹1,250 Amazon purchase (arrived via statement) must not be double counted.
    const original = await prisma.transaction.findFirstOrThrow({ where: { userId, referenceNumber: "AMZ1" } });
    await prisma.transaction.create({
      data: { ...t("2026-09-11", 1250, "DEBIT", "EXPENSE", { creditCardId: card.id, bankAccountId: null }), sourceType: "CSV", duplicateStatus: "DUPLICATE", duplicateOfId: original.id },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("calculates the month's totals exactly", async () => {
    const d = await getDashboardData(userId, { year: 2026, month: 9 });
    expect(d.current.income.toFixed(2)).toBe("85000.00");
    expect(d.current.expenses.toFixed(2)).toBe("42350.00");
    expect(d.current.emi.toFixed(2)).toBe("18500.00");
    expect(d.current.investments.toFixed(2)).toBe("10000.00");
    expect(d.current.creditCardPayments.toFixed(2)).toBe("20000.00");
    expect(d.current.netCashFlow.toFixed(2)).toBe("14150.00");
    expect(d.previous.expenses.toFixed(2)).toBe("5000.00");
  });

  it("calculates net worth and card utilization", async () => {
    const d = await getDashboardData(userId, { year: 2026, month: 9 });
    expect(d.netWorth.totalAssets.toFixed(2)).toBe("112000.00");
    expect(d.netWorth.totalLiabilities.toFixed(2)).toBe("400000.00");
    expect(d.netWorth.netWorth.toFixed(2)).toBe("-288000.00");
    expect(d.cardTotals.utilizationPct.toFixed(2)).toBe("25.00");
    expect(d.cardTotals.availableLimit.toFixed(2)).toBe("150000.00");
    expect(d.trend).toHaveLength(6);
  });
});
