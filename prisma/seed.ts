/**
 * FinSight360 seed
 *
 *   npm run db:seed
 *
 * 1. Always: built-in system categories/sub-categories and system settings
 *    (reference data — safe in every environment).
 * 2. Development only: a DEMO user with realistic sample data so the dashboard
 *    can be explored. Demo data is refused when NODE_ENV=production or
 *    SEED_DEMO_DATA=false. Re-running the seed resets the demo user.
 *
 * Demo login:  demo@finsight360.local  /  Demo@123456
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, type TransactionType, type TransactionDirection, type PaymentMethod } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { DEFAULT_CATEGORIES } from "../lib/categories/defaults";
import { computePosition, instrumentKeyOf, type InvTxn } from "../lib/investments/calc";
import { generateAmortizationSchedule } from "../lib/finance/amortization";
import { nextDueDateFromDay } from "../lib/finance/credit-card";
import { computeNetWorth } from "../lib/finance/net-worth";
import { addDays, addMonths, dateWithDay, todayInTimezone, type YearMonth } from "../lib/dates";
import { seedDefaultsForUser } from "../services/user-setup.service";
import { ledgerNet, recomputeAffected } from "../services/ledger-balance.service";
import { openingForTarget } from "../lib/finance/balances";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const D = (v: string | number) => new Prisma.Decimal(v);

export const DEMO_EMAIL = "demo@finsight360.local";
export const DEMO_PASSWORD = "Demo@123456";

// ─────────────────────────────── reference data ───────────────────────────────

async function seedSystemCategories() {
  let order = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { userId: null, kind: c.kind, name: c.name } });
    const category = existing
      ? await prisma.category.update({ where: { id: existing.id }, data: { icon: c.icon, color: c.color, isFixed: c.isFixed ?? false, isSystem: true, sortOrder: order } })
      : await prisma.category.create({ data: { name: c.name, kind: c.kind, icon: c.icon, color: c.color, isFixed: c.isFixed ?? false, isSystem: true, sortOrder: order } });
    order++;
    let subOrder = 0;
    for (const s of c.subCategories) {
      await prisma.subCategory.upsert({
        where: { categoryId_ownerKey_name: { categoryId: category.id, ownerKey: "system", name: s } },
        update: { isSystem: true, sortOrder: subOrder },
        create: { categoryId: category.id, name: s, isSystem: true, sortOrder: subOrder },
      });
      subOrder++;
    }
  }
  console.log(`✓ System categories: ${DEFAULT_CATEGORIES.length}`);
}

async function seedSystemSettings() {
  const settings: { key: string; value: Prisma.InputJsonValue; description: string }[] = [
    { key: "duplicates.thresholds", value: { autoMatch: 95, review: 70 }, description: "Duplicate score ≥ autoMatch is auto-matched; ≥ review needs user review." },
    { key: "currency.default", value: "INR", description: "Default currency for new users." },
    { key: "timezone.default", value: "Asia/Kolkata", description: "Default timezone for new users." },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({ where: { key: s.key }, update: { value: s.value, description: s.description }, create: s });
  }
  console.log(`✓ System settings: ${settings.length}`);
}

// ─────────────────────────────── demo data ───────────────────────────────

type Txn = {
  id?: string;
  date: Date;
  amount: number | string;
  direction: TransactionDirection;
  type: TransactionType;
  description: string;
  merchant?: string;
  category?: string;
  sub?: string;
  bankAccountId?: string;
  creditCardId?: string;
  loanId?: string;
  paymentMethod?: PaymentMethod;
  incomeCategory?: "SALARY" | "INTEREST" | "OTHER";
};

function normalize(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

async function seedDemoUser() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
    console.log("↺ Removed previous demo user (re-seeding)");
  }

  const user = await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      emailVerified: new Date(),
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      passwordChangedAt: new Date(),
    },
  });
  await prisma.$transaction((tx) => seedDefaultsForUser(tx, user.id));
  const userId = user.id;

  const today = todayInTimezone("Asia/Kolkata");
  const thisMonth: YearMonth = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };

  // ── categories lookup ──
  const cats = await prisma.category.findMany({ where: { userId: null }, include: { subCategories: true } });
  const catId = (name?: string) => cats.find((c) => c.name === name)?.id;
  const subId = (cat?: string, sub?: string) => cats.find((c) => c.name === cat)?.subCategories.find((s) => s.name === sub)?.id;

  // ── accounts ──
  const hdfcBank = await prisma.bankAccount.create({
    data: { userId, bankName: "HDFC Bank", nickname: "Salary Account", accountType: "SALARY", last4: "4821", openingBalance: D(120000), currentBalance: D(184250), notes: "Demo data" },
  });
  const sbiBank = await prisma.bankAccount.create({
    data: { userId, bankName: "State Bank of India", nickname: "Savings", accountType: "SAVINGS", last4: "7703", openingBalance: D(250000), currentBalance: D(292400), notes: "Demo data" },
  });
  await prisma.cashAccount.create({ data: { userId, name: "Wallet cash", openingBalance: D(5000), currentBalance: D(3500) } });

  // ── credit cards ──
  const hdfcCard = await prisma.creditCard.create({
    data: {
      userId, bankName: "HDFC", cardName: "Regalia Gold", network: "VISA", last4: "1043",
      creditLimit: D(200000), statementDay: 15, paymentDueDay: 5,
      currentOutstanding: D(64500), totalAmountDue: D(24500), minimumAmountDue: D(1230),
      currentDueDate: nextDueDateFromDay(5, today), lastStatementDate: dateWithDay(addMonths(thisMonth, -1).year, addMonths(thisMonth, -1).month, 15),
      annualFee: D(2500), rewardPoints: 18240,
    },
  });
  const iciciCard = await prisma.creditCard.create({
    data: {
      userId, bankName: "ICICI", cardName: "Amazon Pay", network: "VISA", last4: "8812",
      creditLimit: D(150000), statementDay: 28, paymentDueDay: 18,
      currentOutstanding: D(18200), totalAmountDue: D(11450), minimumAmountDue: D(580),
      currentDueDate: nextDueDateFromDay(18, today), annualFee: D(0), rewardPoints: 3120,
    },
  });
  const axisCard = await prisma.creditCard.create({
    data: {
      userId, bankName: "Axis", cardName: "Flipkart", network: "MASTERCARD", last4: "5530",
      creditLimit: D(75000), statementDay: 2, paymentDueDay: 22,
      currentOutstanding: D(9850), totalAmountDue: D(9850), minimumAmountDue: D(500),
      currentDueDate: nextDueDateFromDay(22, today), annualFee: D(500), rewardPoints: 860,
    },
  });

  // ── loans with real amortization schedules ──
  const loanDefs = [
    { name: "Car Loan", lender: "HDFC Bank", loanType: "CAR" as const, principal: 500000, rate: 9.5, tenure: 60, emi: 10500, monthsAgo: 18, dueDay: 7, last4: "2291" },
    { name: "Personal Loan", lender: "ICICI Bank", loanType: "PERSONAL" as const, principal: 309500, rate: 11, tenure: 48, emi: 8000, monthsAgo: 9, dueDay: 10, last4: "6618" },
  ];
  const emiTxns: Txn[] = [];
  for (const def of loanDefs) {
    const startYm = addMonths(thisMonth, -def.monthsAgo);
    const firstDue = dateWithDay(startYm.year, startYm.month, def.dueDay);
    const schedule = generateAmortizationSchedule({ principal: def.principal, annualRatePct: def.rate, tenureMonths: def.tenure, firstDueDate: firstDue, emi: def.emi });
    const paid = schedule.filter((r) => r.dueDate < today);
    const principalPaid = paid.reduce((a, r) => a.plus(r.principal), D(0));
    const interestPaid = paid.reduce((a, r) => a.plus(r.interest), D(0));
    const outstanding = paid.length ? paid[paid.length - 1].closingPrincipal : D(def.principal);

    const loan = await prisma.loan.create({
      data: {
        userId, name: def.name, lender: def.lender, loanType: def.loanType, accountLast4: def.last4,
        originalPrincipal: D(def.principal), interestRate: D(def.rate), interestType: "FIXED",
        startDate: addDays(firstDue, -30), firstEmiDate: firstDue, tenureMonths: def.tenure,
        emiAmount: D(def.emi), emiFrequency: "MONTHLY", emiDueDay: def.dueDay,
        principalPaid, interestPaid, outstandingPrincipal: outstanding, repaymentAccountId: hdfcBank.id,
        notes: "Demo data",
      },
    });
    await prisma.loanAmortizationSchedule.createMany({
      data: schedule.map((r) => ({
        loanId: loan.id, installmentNumber: r.installmentNumber, dueDate: r.dueDate,
        openingPrincipal: r.openingPrincipal, emiAmount: r.emi, principalComponent: r.principal,
        interestComponent: r.interest, closingPrincipal: r.closingPrincipal,
        status: r.dueDate < today ? "PAID" : "UPCOMING",
      })),
    });
    const scheduleRows = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: loan.id }, select: { id: true, installmentNumber: true } });

    for (const r of paid) {
      const txId = randomUUID();
      const recent = r.dueDate >= dateWithDay(addMonths(thisMonth, -6).year, addMonths(thisMonth, -6).month, 1);
      if (recent) {
        emiTxns.push({
          id: txId,
          date: r.dueDate, amount: r.emi.toFixed(2), direction: "DEBIT", type: "EMI",
          description: `${def.lender} ${def.name} EMI ${r.installmentNumber}`, merchant: def.lender,
          category: "EMI", sub: def.loanType === "CAR" ? "Car Loan" : "Personal Loan",
          bankAccountId: hdfcBank.id, loanId: loan.id, paymentMethod: "NET_BANKING",
        });
      }
      await prisma.loanPayment.create({
        data: {
          loanId: loan.id, scheduleId: scheduleRows.find((s) => s.installmentNumber === r.installmentNumber)?.id,
          paymentDate: r.dueDate, paymentType: "EMI", amount: r.emi, principalComponent: r.principal, interestComponent: r.interest,
          notes: recent ? `ledger:${txId}` : "Demo data (before ledger window)",
        },
      });
    }
  }

  // ── monthly income & spending (6 full months + current month to date) ──
  const factors = [0.94, 1.08, 0.97, 1.14, 0.9, 1.0]; // index 5 = last full month (acceptance month)
  const txns: Txn[] = [...emiTxns];

  for (let offset = -6; offset <= 0; offset++) {
    const ym = addMonths(thisMonth, offset);
    const f = offset === 0 ? 1 : factors[offset + 6];
    const exact = offset === -1; // last full month uses exact acceptance-test amounts
    const day = (d: number) => dateWithDay(ym.year, ym.month, d);
    const scaled = (v: number) => (exact ? v : Math.round(v * f));
    const add = (t: Txn) => {
      if (offset === 0 && t.date > today) return; // never seed future transactions
      txns.push(t);
    };

    add({ date: day(1), amount: 85000, direction: "CREDIT", type: "INCOME", description: "SALARY CREDIT ACME TECHNOLOGIES PVT LTD", merchant: "Acme Technologies", category: "Salary", sub: "Monthly Salary", bankAccountId: hdfcBank.id, incomeCategory: "SALARY" });
    if (offset === -3) add({ date: day(20), amount: 15000, direction: "CREDIT", type: "INCOME", description: "PERFORMANCE BONUS ACME TECHNOLOGIES", merchant: "Acme Technologies", category: "Salary", sub: "Bonus", bankAccountId: hdfcBank.id, incomeCategory: "SALARY" });
    if (offset % 3 === 0) add({ date: day(28), amount: 642, direction: "CREDIT", type: "INTEREST", description: "SAVINGS INTEREST CREDIT", category: "Interest", sub: "Savings Interest", bankAccountId: sbiBank.id, incomeCategory: "INTEREST" });

    const e = (d: number, amt: number, desc: string, merchant: string, category: string, sub: string, pay: { bank?: string; card?: string; method: PaymentMethod }) =>
      add({ date: day(d), amount: amt, direction: "DEBIT", type: "EXPENSE", description: desc, merchant, category, sub, bankAccountId: pay.bank, creditCardId: pay.card, paymentMethod: pay.method });
    const upi = { bank: hdfcBank.id, method: "UPI" as const };
    const hdfcCc = { card: hdfcCard.id, method: "CREDIT_CARD" as const };
    const iciciCc = { card: iciciCard.id, method: "CREDIT_CARD" as const };
    const axisCc = { card: axisCard.id, method: "CREDIT_CARD" as const };

    // Fixed
    e(2, 15000, "RENT TRANSFER TO LANDLORD", "Landlord", "Rent", "House Rent", { bank: hdfcBank.id, method: "BANK_TRANSFER" });
    e(6, exact ? 1850 : scaled(1850), "BESCOM ELECTRICITY BILL", "BESCOM", "Bills", "Electricity", upi);
    e(8, 999, "ACT FIBERNET INTERNET", "ACT Fibernet", "Bills", "Internet", hdfcCc);
    e(9, 599, "AIRTEL POSTPAID", "Airtel", "Bills", "Mobile", hdfcCc);
    e(12, 649, "NETFLIX.COM SUBSCRIPTION", "Netflix", "Entertainment", "Subscription", hdfcCc);
    e(12, 119, "SPOTIFY INDIA", "Spotify", "Entertainment", "Subscription", hdfcCc);
    // Variable
    e(3, scaled(4820), "BIGBASKET ORDER", "BigBasket", "Food", "Groceries", iciciCc);
    e(17, scaled(1640), "BLINKIT ORDER", "Blinkit", "Food", "Groceries", upi);
    e(5, scaled(645), "SWIGGY ORDER", "Swiggy", "Food", "Food Delivery", hdfcCc);
    e(14, scaled(890), "SWIGGY ORDER", "Swiggy", "Food", "Food Delivery", hdfcCc);
    e(23, scaled(775), "SWIGGY ORDER", "Swiggy", "Food", "Food Delivery", hdfcCc);
    e(19, scaled(1180), "ZOMATO ORDER", "Zomato", "Food", "Food Delivery", upi);
    e(11, scaled(1420), "UBER TRIP", "Uber", "Transport", "Taxi", hdfcCc);
    e(7, scaled(3000), "INDIAN OIL FUEL STATION", "Indian Oil", "Transport", "Fuel", iciciCc);
    e(21, scaled(3499), "AMAZON.IN ORDER", "Amazon", "Shopping", "Online Shopping", iciciCc);
    e(25, scaled(1000), "MYNTRA ORDER", "Myntra", "Shopping", "Clothing", axisCc);
    e(16, scaled(860), "APOLLO PHARMACY", "Apollo Pharmacy", "Medical", "Pharmacy", upi);
    e(26, scaled(740), "BOOKMYSHOW TICKETS", "BookMyShow", "Entertainment", "Movies", hdfcCc);
    e(13, scaled(665), "STARBUCKS COFFEE", "Starbucks", "Food", "Cafe", upi);
    e(27, scaled(2000), "DINNER - TRUFFLES RESTAURANT", "Truffles", "Food", "Restaurant", axisCc);
    if (offset === -2) e(15, 12800, "MAKEMYTRIP FLIGHT BOOKING", "MakeMyTrip", "Travel", "Flights", hdfcCc);

    // Investments (SIP) — not expenses
    for (const [d, name] of [[10, "PARAG PARIKH FLEXI CAP SIP"], [10, "NIFTY 50 INDEX FUND SIP"]] as const) {
      add({ date: day(d), amount: 5000, direction: "DEBIT", type: "INVESTMENT", description: name, merchant: "Groww", category: "Investment", sub: "SIP", bankAccountId: hdfcBank.id, paymentMethod: "NET_BANKING" });
    }
    // Card bill payment — not an expense (purchases were already counted)
    add({ date: day(4), amount: 7000, direction: "DEBIT", type: "CARD_PAYMENT", description: "HDFC CREDIT CARD PAYMENT", category: "Transfer", sub: "Credit Card Payment", bankAccountId: hdfcBank.id, creditCardId: hdfcCard.id, paymentMethod: "NET_BANKING" });
    add({ date: day(18), amount: 11000, direction: "DEBIT", type: "CARD_PAYMENT", description: "ICICI CREDIT CARD PAYMENT", category: "Transfer", sub: "Credit Card Payment", bankAccountId: sbiBank.id, creditCardId: iciciCard.id, paymentMethod: "NET_BANKING" });
    add({ date: day(22), amount: 3000, direction: "DEBIT", type: "CARD_PAYMENT", description: "AXIS CREDIT CARD PAYMENT", category: "Transfer", sub: "Credit Card Payment", bankAccountId: sbiBank.id, creditCardId: axisCard.id, paymentMethod: "NET_BANKING" });
  }

  // ── merchants ──
  const merchantNames = Array.from(new Set(txns.map((t) => t.merchant).filter((m): m is string => Boolean(m))));
  await prisma.merchant.createMany({ data: merchantNames.map((name) => ({ userId, name, normalizedName: normalize(name) })) });
  const merchants = await prisma.merchant.findMany({ where: { userId } });
  const merchantId = (name?: string) => (name ? merchants.find((m) => m.name === name)?.id : undefined);

  // ── ledger rows (one Transaction + one TransactionSource each) ──
  const txRows: Prisma.TransactionCreateManyInput[] = [];
  const sourceRows: Prisma.TransactionSourceCreateManyInput[] = [];
  const expenseRows: Prisma.ExpenseCreateManyInput[] = [];
  const incomeRows: Prisma.IncomeCreateManyInput[] = [];
  txns.forEach((t, i) => {
    const id = t.id ?? randomUUID();
    txRows.push({
      id, userId, bankAccountId: t.bankAccountId, creditCardId: t.creditCardId, loanId: t.loanId,
      transactionDate: t.date, amount: D(t.amount), direction: t.direction, transactionType: t.type,
      status: "CONFIRMED", merchantId: merchantId(t.merchant), merchantName: t.merchant,
      description: t.description, normalizedDescription: normalize(t.description),
      categoryId: catId(t.category), subCategoryId: subId(t.category, t.sub),
      sourceType: "MANUAL", duplicateStatus: "UNIQUE", notes: "Demo data",
    });
    sourceRows.push({ userId, transactionId: id, sourceType: "MANUAL", externalId: `demo-seed-${i}`, rawDescription: t.description, rawAmount: D(t.amount) });
    if (t.type === "EXPENSE") expenseRows.push({ userId, transactionId: id, paymentMethod: t.paymentMethod ?? "OTHER", isDiscretionary: !["Rent", "Bills", "Insurance", "EMI"].includes(t.category ?? "") });
    if (t.direction === "CREDIT" && (t.type === "INCOME" || t.type === "INTEREST")) incomeRows.push({ userId, transactionId: id, incomeCategory: t.incomeCategory ?? "OTHER", sourceName: t.merchant, isRecurring: t.incomeCategory === "SALARY" });
  });
  await prisma.transaction.createMany({ data: txRows });
  await prisma.transactionSource.createMany({ data: sourceRows });
  await prisma.expense.createMany({ data: expenseRows });
  await prisma.income.createMany({ data: incomeRows });

  // Reconcile stored balances to realistic "as of today" figures:
  // opening value = target − effect of the seeded ledger, then recompute from the ledger.
  const targets: { kind: "bank" | "card"; id: string; target: number }[] = [
    { kind: "bank", id: hdfcBank.id, target: 284250 },
    { kind: "bank", id: sbiBank.id, target: 292400 },
    { kind: "card", id: hdfcCard.id, target: 64500 },
    { kind: "card", id: iciciCard.id, target: 18200 },
    { kind: "card", id: axisCard.id, target: 9850 },
  ];
  for (const t of targets) {
    const net = await ledgerNet(prisma, { kind: t.kind, id: t.id, userId });
    if (t.kind === "bank") await prisma.bankAccount.update({ where: { id: t.id }, data: { openingBalance: openingForTarget(t.target, net) } });
    else await prisma.creditCard.update({ where: { id: t.id }, data: { openingOutstanding: openingForTarget(t.target, net) } });
  }
  await recomputeAffected(prisma, { bank: new Set([hdfcBank.id, sbiBank.id]), card: new Set([hdfcCard.id, iciciCard.id, axisCard.id]), cash: new Set() });

  // Link loan payments to their ledger transactions.
  const linked = await prisma.loanPayment.findMany({ where: { loan: { userId }, notes: { startsWith: "ledger:" } } });
  for (const p of linked) {
    await prisma.loanPayment.update({ where: { id: p.id }, data: { transactionId: p.notes!.slice(7), notes: "Demo data" } });
  }

  // ── recurring commitments ──
  const recurring = [
    { name: "House rent", amount: 15000, day: 2, category: "Rent", sub: "House Rent", merchant: "Landlord", type: "EXPENSE" as const },
    { name: "Netflix", amount: 649, day: 12, category: "Entertainment", sub: "Subscription", merchant: "Netflix", type: "EXPENSE" as const },
    { name: "Spotify", amount: 119, day: 12, category: "Entertainment", sub: "Subscription", merchant: "Spotify", type: "EXPENSE" as const },
    { name: "ACT Fibernet", amount: 999, day: 8, category: "Bills", sub: "Internet", merchant: "ACT Fibernet", type: "EXPENSE" as const },
    { name: "SIP — Flexi Cap", amount: 5000, day: 10, category: "Investment", sub: "SIP", merchant: "Groww", type: "INVESTMENT" as const },
    { name: "SIP — Nifty 50 Index", amount: 5000, day: 10, category: "Investment", sub: "SIP", merchant: "Groww", type: "INVESTMENT" as const },
  ];
  for (const r of recurring) {
    await prisma.recurringTransaction.create({
      data: {
        userId, name: r.name, expectedAmount: D(r.amount), frequency: "MONTHLY", dayOfMonth: r.day,
        nextDueDate: nextDueDateFromDay(r.day, addDays(today, 1)), lastSeenDate: dateWithDay(addMonths(thisMonth, -1).year, addMonths(thisMonth, -1).month, r.day),
        occurrenceCount: 6, detectionConfidence: D(96), status: "CONFIRMED", direction: "DEBIT", transactionType: r.type,
        categoryId: catId(r.category), subCategoryId: subId(r.category, r.sub), merchantId: merchantId(r.merchant),
      },
    });
  }

  // ── investments ──
  const growwAcct = await prisma.investmentAccount.create({
    data: { userId, name: "Groww (demo)", providerType: "MANUAL", providerName: "Groww", accountType: "DEMAT", notes: "Demo data — entered manually, not connected" },
  });
  const holdings = [
    { name: "Parag Parikh Flexi Cap Fund – Direct Growth", type: "MUTUAL_FUND" as const, isin: "INF879O01027", qty: "1820.455", avg: "68.6500", price: "84.1200" },
    { name: "Nifty 50 Index Fund – Direct Growth", type: "MUTUAL_FUND" as const, qty: "4310.220", avg: "22.4100", price: "26.9800" },
    { name: "Nippon India ETF Nifty BeES", type: "ETF" as const, symbol: "NIFTYBEES", qty: "300", avg: "238.5000", price: "276.1000" },
  ];
  for (const h of holdings) {
    const qty = D(h.qty);
    const invested = qty.times(h.avg).toDecimalPlaces(2);
    const current = qty.times(h.price).toDecimalPlaces(2);
    await prisma.investmentHolding.create({
      data: {
        userId, investmentAccountId: growwAcct.id, instrumentName: h.name, instrumentType: h.type,
        instrumentKey: instrumentKeyOf({ instrumentName: h.name, isin: "isin" in h ? h.isin : null, symbol: "symbol" in h ? h.symbol : null }),
        isin: "isin" in h ? h.isin : null, symbol: "symbol" in h ? h.symbol : null, quantity: qty, averageBuyPrice: D(h.avg), investedAmount: invested,
        currentPrice: D(h.price), currentValue: current, lastPricedAt: new Date(),
      },
    });
  }
  // One stock with real transaction history (so XIRR and realised gains show up).
  const addDaysUtc = (n: number) => {
    const t = new Date();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + n));
  };
  const infyRaw: { type: InvTxn["type"]; tradeDate: Date; quantity: string; price: string; amount?: string }[] = [
    { type: "BUY" as const, tradeDate: addDaysUtc(-420), quantity: "25", price: "1380.0000" },
    { type: "BUY" as const, tradeDate: addDaysUtc(-250), quantity: "25", price: "1460.0000" },
    { type: "DIVIDEND" as const, tradeDate: addDaysUtc(-150), quantity: "0", price: "0", amount: "1050.00" },
    { type: "SELL" as const, tradeDate: addDaysUtc(-60), quantity: "10", price: "1610.0000" },
  ];
  const infyTxns = infyRaw.map((t) => ({ ...t, amount: t.amount ?? D(t.quantity).times(t.price).toDecimalPlaces(2).toFixed(2), charges: "0" }));
  const infyPos = computePosition(infyTxns);
  const infy = await prisma.investmentHolding.create({
    data: {
      userId, investmentAccountId: growwAcct.id, instrumentName: "Infosys Ltd", instrumentType: "STOCK", instrumentKey: instrumentKeyOf({ instrumentName: "Infosys Ltd", symbol: "INFY" }),
      symbol: "INFY", quantity: infyPos.quantity, averageBuyPrice: infyPos.averageBuyPrice, investedAmount: infyPos.investedAmount,
      realizedGainLoss: infyPos.realizedGainLoss.plus(infyPos.dividends), currentPrice: D("1588.4000"), currentValue: infyPos.quantity.times("1588.40").toDecimalPlaces(2), lastPricedAt: new Date(),
    },
  });
  for (const t of infyTxns) {
    await prisma.investmentTransaction.create({ data: { userId, investmentAccountId: growwAcct.id, holdingId: infy.id, type: t.type, tradeDate: t.tradeDate, quantity: D(t.quantity), price: D(t.price), amount: D(t.amount), notes: "Demo" } });
  }
  const hs = await prisma.investmentHolding.findMany({ where: { userId } });
  const investedTotal = hs.reduce((a, h) => a.plus(h.investedAmount), D(0));
  const currentTotal = hs.reduce((a, h) => a.plus(h.currentValue ?? 0), D(0));

  // ── month-end snapshots (demo history for the trend charts) ──
  const loansNow = await prisma.loan.findMany({ where: { userId } });
  const nw = computeNetWorth({
    bankBalances: [284250, 292400],
    cashBalances: [3500],
    investmentValues: [currentTotal],
    loanOutstanding: loansNow.map((l) => l.outstandingPrincipal),
    creditCardOutstanding: [64500, 18200, 9850],
  });
  for (let m = 6; m >= 1; m--) {
    const ym = addMonths(thisMonth, -m);
    const monthEnd = addDays(dateWithDay(addMonths(ym, 1).year, addMonths(ym, 1).month, 1), -1);
    const drift = D(1).minus(D(m).times("0.035")); // gentle upward trend toward today
    const assets = nw.totalAssets.times(drift).toDecimalPlaces(2);
    const liabilities = nw.totalLiabilities.times(D(1).plus(D(m).times("0.02"))).toDecimalPlaces(2);
    await prisma.netWorthSnapshot.create({ data: { userId, snapshotDate: monthEnd, totalAssets: assets, totalLiabilities: liabilities, netWorth: assets.minus(liabilities) } });
    await prisma.portfolioSnapshot.create({
      data: { userId, snapshotDate: monthEnd, investedAmount: investedTotal.minus(D(10000).times(m)), currentValue: currentTotal.times(drift).toDecimalPlaces(2) },
    });
  }

  // ── reminders ──
  const reminders = [
    { type: "INSURANCE" as const, title: "Health insurance premium", amount: 24500, inDays: 12, recurrence: "YEARLY" as const },
    { type: "CUSTOM" as const, title: "Property tax", amount: 6800, inDays: 20, recurrence: "YEARLY" as const },
    { type: "BILL" as const, title: "Piped gas bill", amount: 720, inDays: -1, recurrence: "MONTHLY" as const },
    { type: "INSURANCE" as const, title: "Car insurance renewal", amount: 14250, inDays: 45, recurrence: "YEARLY" as const },
  ];
  for (const r of reminders) {
    await prisma.reminder.create({
      data: { userId, type: r.type, title: r.title, amount: D(r.amount), dueDate: addDays(today, r.inDays), recurrence: r.recurrence, leadDays: 3 },
    });
  }
  await prisma.reminder.create({
    data: { userId, type: "CREDIT_CARD_DUE", title: "HDFC Regalia Gold payment", amount: D(24500), dueDate: hdfcCard.currentDueDate!, creditCardId: hdfcCard.id, recurrence: "MONTHLY", leadDays: 3 },
  });

  // ── a couple of in-app notifications ──
  const daysToHdfc = Math.round((hdfcCard.currentDueDate!.getTime() - today.getTime()) / 86_400_000);
  await prisma.notification.createMany({
    data: [
      { userId, type: "CARD_DUE", title: "Credit-card payment due", body: `Your HDFC credit-card payment is due in ${daysToHdfc} day${daysToHdfc === 1 ? "" : "s"}.`, link: "/credit-cards", dedupeKey: "demo-card-due" },
      { userId, type: "UTILIZATION_ALERT", title: "High utilization", body: "HDFC Regalia Gold utilization (32.25%) is above your 30% threshold.", link: "/credit-cards", dedupeKey: "demo-util" },
    ],
  });

  console.log(`✓ Demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  2 bank accounts, 3 credit cards, 2 loans (with schedules), ${txRows.length} transactions,`);
  console.log(`  ${recurring.length} recurring commitments, ${hs.length} holdings, ${reminders.length + 1} reminders`);
}

async function main() {
  await seedSystemCategories();
  await seedSystemSettings();

  const isProd = process.env.NODE_ENV === "production";
  if (isProd || process.env.SEED_DEMO_DATA === "false") {
    console.log("• Demo data skipped (production or SEED_DEMO_DATA=false).");
    return;
  }
  await seedDemoUser();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
