/**
 * Realistic TEST data for checking every screen and report.
 *
 *   npm run seed:test
 *
 * Creates (or re-creates) a separate login:  test@finsight360.local / Test@123456
 * Your own account and the demo user are never touched.
 *
 * Contents (1 April 2026 → today):
 *  • 10 bank accounts, 10 credit cards, 10 personal loans
 *  • salary every month, savings transfers, quarterly savings interest
 *  • 2–3 everyday expenses per day, capped at ₹15,000 per month (bills and subscriptions included)
 *  • every card statement paid in full on its due date from a bank account; the current
 *    statements are left due so Reminders and the dashboard show upcoming card bills
 *  • every loan EMI paid from the bank (one EMI deliberately left overdue)
 *  • month-end net-worth snapshots, budgets, reminders, detected recurring payments, notifications
 *
 * Everything goes through the app's own services, so balances, outstanding amounts,
 * loan schedules, categories and audit entries are calculated exactly as in normal use.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { todayInTimezone, addDays } from "@/lib/dates";
import { seedDefaultsForUser } from "@/services/user-setup.service";
import { createBankAccount } from "@/services/account.service";
import { createCreditCard } from "@/services/credit-card.service";
import { createTransaction } from "@/services/transaction.service";
import { createLoan, recordLoanPayment } from "@/services/loan.service";
import { currentNetWorth } from "@/services/networth.service";
import { saveBudget } from "@/services/budget.service";
import { saveReminder } from "@/services/reminder.service";
import { detectRecurringForUser, updateRecurring } from "@/services/recurring.service";
import { generateNotificationsForUser } from "@/services/notification.service";

export const TEST_EMAIL = "test@finsight360.local";
export const TEST_PASSWORD = "Test@123456";
const MONTHLY_CAP = 15000;
const START = new Date(Date.UTC(2026, 3, 1)); // 1 April 2026
const meta = { ip: null, userAgent: "seed-test-data" };

// ───────────────────────────── deterministic random ─────────────────────────────
let seed = 360;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (a: number, b: number) => a + rnd() * (b - a);
const int = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const weighted = <T extends { w: number }>(xs: T[]) => {
  let r = rnd() * xs.reduce((a, x) => a + x.w, 0);
  for (const x of xs) if ((r -= x.w) < 0) return x;
  return xs[xs.length - 1];
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ymKey = (d: Date) => iso(d).slice(0, 7);
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

// ───────────────────────────── master data ─────────────────────────────
const BANKS = [
  { bankName: "HDFC Bank", nickname: "Salary Account", accountType: "SALARY", last4: "4821", opening: 85000 },
  { bankName: "State Bank of India", nickname: "SBI Savings", accountType: "SAVINGS", last4: "7703", opening: 240000 },
  { bankName: "ICICI Bank", nickname: "ICICI Savings", accountType: "SAVINGS", last4: "3310", opening: 65000 },
  { bankName: "Axis Bank", nickname: "Axis Savings", accountType: "SAVINGS", last4: "9142", opening: 48000 },
  { bankName: "Kotak Mahindra Bank", nickname: "Kotak 811", accountType: "SAVINGS", last4: "5567", opening: 32000 },
  { bankName: "Federal Bank", nickname: "Federal Savings", accountType: "SAVINGS", last4: "2290", opening: 120000 },
  { bankName: "IDFC FIRST Bank", nickname: "IDFC Savings", accountType: "SAVINGS", last4: "6618", opening: 75000 },
  { bankName: "Yes Bank", nickname: "Yes Savings", accountType: "SAVINGS", last4: "4402", opening: 18000 },
  { bankName: "Canara Bank", nickname: "Canara Savings", accountType: "SAVINGS", last4: "8035", opening: 55000 },
  { bankName: "Bank of Baroda", nickname: "BoB Current", accountType: "CURRENT", last4: "1179", opening: 30000 },
] as const;

// payFrom = index into BANKS
const CARDS = [
  { bankName: "HDFC Bank", cardName: "Millennia", network: "VISA", last4: "1043", creditLimit: 150000, statementDay: 15, paymentDueDay: 5, payFrom: 0 },
  { bankName: "SBI Card", cardName: "SimplyCLICK", network: "VISA", last4: "2218", creditLimit: 80000, statementDay: 20, paymentDueDay: 10, payFrom: 1 },
  { bankName: "ICICI Bank", cardName: "Amazon Pay", network: "VISA", last4: "6634", creditLimit: 200000, statementDay: 3, paymentDueDay: 21, payFrom: 2 },
  { bankName: "Axis Bank", cardName: "Flipkart", network: "MASTERCARD", last4: "7781", creditLimit: 120000, statementDay: 12, paymentDueDay: 2, payFrom: 3 },
  { bankName: "Kotak Mahindra Bank", cardName: "League Platinum", network: "VISA", last4: "3305", creditLimit: 60000, statementDay: 25, paymentDueDay: 13, payFrom: 4 },
  { bankName: "IDFC FIRST Bank", cardName: "Select", network: "VISA", last4: "9026", creditLimit: 175000, statementDay: 18, paymentDueDay: 6, payFrom: 6 },
  { bankName: "American Express", cardName: "Membership Rewards", network: "AMEX", last4: "1007", creditLimit: 250000, statementDay: 22, paymentDueDay: 11, payFrom: 1 },
  { bankName: "OneCard", cardName: "OneCard Metal", network: "VISA", last4: "4590", creditLimit: 100000, statementDay: 8, paymentDueDay: 26, payFrom: 5 },
  { bankName: "AU Small Finance Bank", cardName: "LIT", network: "RUPAY", last4: "8812", creditLimit: 50000, statementDay: 28, paymentDueDay: 16, payFrom: 8 },
  { bankName: "RBL Bank", cardName: "Shoprite", network: "MASTERCARD", last4: "5123", creditLimit: 70000, statementDay: 10, paymentDueDay: 30, payFrom: 7 },
] as const;

// Personal loans: first EMI between April and June; repaid from the bank at payFrom.
const LOANS = [
  { name: "Bajaj personal loan", lender: "Bajaj Finserv", principal: 150000, rate: "13.5", tenure: 36, start: "2026-03-05", firstEmi: "2026-04-05", payFrom: 0, last4: "5501" },
  { name: "HDFC personal loan", lender: "HDFC Bank", principal: 200000, rate: "11.25", tenure: 48, start: "2026-03-01", firstEmi: "2026-04-07", payFrom: 0, last4: "7712" },
  { name: "ICICI insta loan", lender: "ICICI Bank", principal: 75000, rate: "12.75", tenure: 24, start: "2026-03-10", firstEmi: "2026-04-10", payFrom: 2, last4: "3398" },
  { name: "Tata Capital loan", lender: "Tata Capital", principal: 100000, rate: "14", tenure: 30, start: "2026-03-12", firstEmi: "2026-04-12", payFrom: 1, last4: "6620" },
  { name: "Axis personal loan", lender: "Axis Bank", principal: 120000, rate: "12.5", tenure: 36, start: "2026-03-15", firstEmi: "2026-04-15", payFrom: 3, last4: "8843" },
  { name: "Kotak personal loan", lender: "Kotak Mahindra Bank", principal: 60000, rate: "13", tenure: 18, start: "2026-03-18", firstEmi: "2026-04-18", payFrom: 4, last4: "2207" },
  { name: "IDFC FIRST loan", lender: "IDFC FIRST Bank", principal: 90000, rate: "12", tenure: 24, start: "2026-04-01", firstEmi: "2026-05-03", payFrom: 6, last4: "9154" },
  { name: "SMFG personal loan", lender: "SMFG India Credit", principal: 80000, rate: "15.5", tenure: 24, start: "2026-04-20", firstEmi: "2026-05-20", payFrom: 5, last4: "4471" },
  { name: "Aditya Birla loan", lender: "Aditya Birla Capital", principal: 110000, rate: "14.25", tenure: 36, start: "2026-05-02", firstEmi: "2026-06-02", payFrom: 1, last4: "6035" },
  { name: "Home Credit loan", lender: "Home Credit India", principal: 50000, rate: "16", tenure: 12, start: "2026-05-25", firstEmi: "2026-06-25", payFrom: 8, last4: "1186" },
] as const;
/** This EMI is left unpaid so Reminders/notifications show an overdue item. */
const SKIP_EMI = { loan: 6, dueDate: "2026-10-03" };

type Item = { w: number; desc: string; merchant: string; cat: string; sub: string; min: number; max: number; via: "card" | "upi" | "any" };
const EVERYDAY: Item[] = [
  { w: 14, desc: "Tea & snacks", merchant: "Chai Point", cat: "Food", sub: "Cafe", min: 30, max: 120, via: "upi" },
  { w: 10, desc: "Groceries", merchant: "BigBasket", cat: "Food", sub: "Groceries", min: 180, max: 650, via: "any" },
  { w: 6, desc: "Vegetables & fruits", merchant: "Local vegetable shop", cat: "Food", sub: "Groceries", min: 60, max: 220, via: "upi" },
  { w: 6, desc: "Food order", merchant: "Swiggy", cat: "Food", sub: "Food Delivery", min: 150, max: 420, via: "card" },
  { w: 5, desc: "Food order", merchant: "Zomato", cat: "Food", sub: "Food Delivery", min: 140, max: 400, via: "card" },
  { w: 4, desc: "Lunch", merchant: "Udupi Grand", cat: "Food", sub: "Restaurant", min: 90, max: 260, via: "upi" },
  { w: 3, desc: "Coffee", merchant: "Third Wave Coffee", cat: "Food", sub: "Cafe", min: 160, max: 320, via: "card" },
  { w: 8, desc: "Auto ride", merchant: "Namma Yatri", cat: "Transport", sub: "Taxi", min: 50, max: 160, via: "upi" },
  { w: 5, desc: "Cab ride", merchant: "Uber", cat: "Transport", sub: "Uber", min: 120, max: 380, via: "card" },
  { w: 3, desc: "Metro card recharge", merchant: "Namma Metro", cat: "Transport", sub: "Public Transport", min: 100, max: 200, via: "upi" },
  { w: 3, desc: "Petrol", merchant: "Indian Oil", cat: "Transport", sub: "Fuel", min: 300, max: 700, via: "card" },
  { w: 4, desc: "Online order", merchant: "Amazon", cat: "Shopping", sub: "Online Shopping", min: 199, max: 899, via: "card" },
  { w: 2, desc: "Household items", merchant: "DMart", cat: "Shopping", sub: "Household", min: 150, max: 600, via: "any" },
  { w: 1, desc: "Clothing", merchant: "Myntra", cat: "Shopping", sub: "Clothing", min: 399, max: 1200, via: "card" },
  { w: 2, desc: "Medicines", merchant: "Apollo Pharmacy", cat: "Medical", sub: "Pharmacy", min: 90, max: 450, via: "any" },
  { w: 1, desc: "Haircut", merchant: "Green Trends", cat: "Personal Care", sub: "Salon", min: 150, max: 350, via: "upi" },
  { w: 1, desc: "Movie tickets", merchant: "BookMyShow", cat: "Entertainment", sub: "Movies", min: 250, max: 600, via: "card" },
];
/** Fixed monthly bills and subscriptions (counted inside the ₹15,000 cap). */
const MONTHLY = [
  { dom: 8, desc: "Airtel postpaid bill", merchant: "Airtel", cat: "Bills", sub: "Mobile", amt: () => 399, via: { card: 2 } },
  { dom: 10, desc: "ACT Fibernet broadband", merchant: "ACT Fibernet", cat: "Bills", sub: "Internet", amt: () => 589, via: { bank: 3 } },
  { dom: 12, desc: "Netflix subscription", merchant: "Netflix", cat: "Subscriptions", sub: "Streaming", amt: () => 199, via: { card: 0 } },
  { dom: 14, desc: "Spotify Premium", merchant: "Spotify", cat: "Subscriptions", sub: "Streaming", amt: () => 119, via: { card: 5 } },
  { dom: 18, desc: "BESCOM electricity bill", merchant: "BESCOM", cat: "Bills", sub: "Electricity", amt: () => int(780, 1350), via: { bank: 0 } },
  { dom: 22, desc: "Gym membership", merchant: "Cult.fit", cat: "Personal Care", sub: "Fitness", amt: () => 999, via: { card: 6 } },
];
const UPI_BANKS = [0, 0, 1, 2, 2, 3, 4, 4, 6, 9];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_TEST_DATA !== "true") {
    throw new Error("Refusing to create test data in production (set ALLOW_TEST_DATA=true to override).");
  }
  const today = todayInTimezone("Asia/Kolkata");
  console.log(`▶ Building test data from ${iso(START)} to ${iso(today)}…`);

  // ── fresh test user ──
  const old = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (old) {
    await prisma.user.delete({ where: { id: old.id } });
    console.log("↺ Removed the previous test user");
  }
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, name: "Test User", emailVerified: new Date(), passwordHash: await bcrypt.hash(TEST_PASSWORD, 12), passwordChangedAt: new Date() },
  });
  const userId = user.id;
  await prisma.$transaction((tx) => seedDefaultsForUser(tx, userId));

  const cats = await prisma.category.findMany({ where: { userId: null }, include: { subCategories: true } });
  const catOf = (cat: string, sub?: string) => {
    const c = cats.find((x) => x.name === cat);
    if (!c) throw new Error(`category ${cat} missing — run npm run db:seed first`);
    return { categoryId: c.id, subCategoryId: sub ? c.subCategories.find((s) => s.name === sub)?.id ?? null : null };
  };

  // ── accounts, cards, loans ──
  const banks: string[] = [];
  for (const b of BANKS) {
    const a = await createBankAccount(userId, { bankName: b.bankName, nickname: b.nickname, accountType: b.accountType, last4: b.last4, currentBalance: String(b.opening), notes: "Test data" }, meta);
    banks.push(a.id);
  }
  const cards: string[] = [];
  for (const c of CARDS) {
    const r = await createCreditCard(userId, { bankName: c.bankName, cardName: c.cardName, network: c.network, last4: c.last4, creditLimit: String(c.creditLimit), statementDay: c.statementDay, paymentDueDay: c.paymentDueDay, currentOutstanding: "0", notes: "Test data" }, meta);
    cards.push(r.id);
  }
  const loans: string[] = [];
  for (const l of LOANS) {
    const r = await createLoan(userId, { name: l.name, lender: l.lender, loanType: "PERSONAL", accountLast4: l.last4, principal: String(l.principal), interestRate: l.rate, tenureMonths: l.tenure, startDate: l.start, firstEmiDate: l.firstEmi, repaymentAccountId: banks[l.payFrom], roundEmiToRupee: true, notes: "Test data" }, meta);
    loans.push(r.id);
  }
  console.log("✓ 10 bank accounts, 10 credit cards, 10 personal loans");

  // ── helpers ──
  let count = 0;
  const tx = async (input: Record<string, unknown>) => {
    await createTransaction(userId, input, meta);
    count++;
  };
  const cardSpend = cards.map(() => 0); // spend since the card's last statement
  const monthSpend = new Map<string, number>();
  const pendingCardPayments: { date: string; card: number; amount: number }[] = [];
  /** Latest statement of each card (paid or not) — stored on the card like a user would enter it. */
  const lastStatement = new Map<number, { stmt: Date; due: Date; amount: number }>();

  const spend = async (date: Date, it: { desc: string; merchant: string; cat: string; sub: string }, amount: number, via: { card: number } | { bank: number }) => {
    const c = catOf(it.cat, it.sub);
    if ("card" in via) {
      await tx({ kind: "EXPENSE", transactionDate: iso(date), amount: money(amount), account: `card:${cards[via.card]}`, description: it.desc, merchantName: it.merchant, ...c, paymentMethod: "CREDIT_CARD" });
      cardSpend[via.card] += amount;
    } else {
      await tx({ kind: "EXPENSE", transactionDate: iso(date), amount: money(amount), account: `bank:${banks[via.bank]}`, description: `UPI-${it.merchant.toUpperCase().replace(/[^A-Z ]/g, "")}`, merchantName: it.merchant, ...c, paymentMethod: "UPI" });
    }
    monthSpend.set(ymKey(date), (monthSpend.get(ymKey(date)) ?? 0) + amount);
  };

  // Plan each month's everyday spending so the month (incl. bills) stays under the cap.
  const plans = new Map<string, Map<string, { it: Item; amount: number }[]>>();
  const planMonth = (y: number, m: number) => {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (plans.has(key)) return plans.get(key)!;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const fixed = 399 + 589 + 199 + 119 + 1350 + 999; // worst case bills
    const target = between(MONTHLY_CAP * 0.82, MONTHLY_CAP * 0.97) - fixed;
    const byDay = new Map<string, { it: Item; amount: number }[]>();
    let total = 0;
    for (let d = 1; d <= days; d++) {
      const list: { it: Item; amount: number }[] = [];
      const n = rnd() < 0.55 ? 2 : 3;
      for (let i = 0; i < n; i++) {
        const it = weighted(EVERYDAY);
        const amount = Math.round(between(it.min, it.max));
        list.push({ it, amount });
        total += amount;
      }
      byDay.set(iso(day(y, m, d)), list);
    }
    const scale = Math.min(1, target / total);
    for (const list of byDay.values()) for (const e of list) e.amount = Math.max(20, Math.round(e.amount * scale));
    plans.set(key, byDay);
    return byDay;
  };

  // Loan EMIs due by date
  const schedules = await prisma.loanAmortizationSchedule.findMany({ where: { loanId: { in: loans } }, orderBy: { dueDate: "asc" } });
  const emisByDate = new Map<string, typeof schedules>();
  for (const s of schedules) {
    const k = iso(s.dueDate);
    emisByDate.set(k, [...(emisByDate.get(k) ?? []), s]);
  }

  const snapshot = async (date: Date) => {
    const { netWorth } = await currentNetWorth(userId);
    await prisma.netWorthSnapshot.upsert({
      where: { userId_snapshotDate: { userId, snapshotDate: date } },
      update: { totalAssets: netWorth.totalAssets, totalLiabilities: netWorth.totalLiabilities, netWorth: netWorth.netWorth },
      create: { userId, snapshotDate: date, totalAssets: netWorth.totalAssets, totalLiabilities: netWorth.totalLiabilities, netWorth: netWorth.netWorth },
    });
  };

  // ── day by day ──
  for (let d = new Date(START); d <= today; d = addDays(d, 1)) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const dom = d.getUTCDate();
    const ds = iso(d);

    // Salary (1st) and savings moves (2nd)
    if (dom === 1) {
      await tx({ kind: "INCOME", transactionDate: ds, amount: "145000.00", account: `bank:${banks[0]}`, description: "NEFT CR ACME TECHNOLOGIES PVT LTD SALARY", merchantName: "ACME Technologies", sourceName: "ACME Technologies", incomeCategory: "SALARY", ...catOf("Salary", "Monthly Salary") });
    }
    if (dom === 2) {
      const moves: [number, number, number, string][] = [
        [0, 1, 25000, "Monthly savings to SBI"],
        [0, 2, 8000, "Top-up ICICI (card & loan payments)"],
        [0, 3, 7000, "Top-up Axis (bills & loan)"],
        [0, 4, 4000, "Top-up Kotak 811"],
        [0, 6, 6000, "Top-up IDFC (loan & card)"],
        [0, 5, 5000, "Top-up Federal (loan & card)"],
        [0, 8, 6000, "Top-up Canara (loan & card)"],
        [0, 7, 1500, "Top-up Yes Bank (card)"],
        [0, 9, 3000, "Monthly transfer to BoB"],
      ];
      for (const [from, to, amt, desc] of moves) {
        await tx({ kind: "TRANSFER", transactionDate: ds, amount: money(amt), account: `bank:${banks[from]}`, toAccount: `bank:${banks[to]}`, description: desc, paymentMethod: "NET_BANKING" });
      }
    }
    // Quarterly savings interest (last day of June and September)
    if ((m === 6 && dom === 30) || (m === 9 && dom === 30)) {
      for (const i of [1, 2, 3, 5, 6, 8]) {
        const bal = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: banks[i] } })).currentBalance.toNumber();
        await tx({ kind: "INTEREST", transactionDate: ds, amount: money((bal * 0.03) / 4), account: `bank:${banks[i]}`, description: "Savings account interest credit", incomeCategory: "INTEREST", ...catOf("Interest", "Savings Interest") });
      }
    }

    // Fixed monthly bills & subscriptions
    for (const b of MONTHLY) {
      if (b.dom !== dom) continue;
      await spend(d, b, b.amt(), "card" in b.via ? { card: b.via.card! } : { bank: b.via.bank! });
    }

    // Everyday spending (2–3 per day)
    for (const e of planMonth(y, m).get(ds) ?? []) {
      const useCard = e.it.via === "card" || (e.it.via === "any" && rnd() < 0.5);
      await spend(d, e.it, e.amount, useCard ? { card: int(0, 9) } : { bank: pick(UPI_BANKS) });
    }
    // An occasional refund (Amazon return) back to a card
    if (dom === 21 && (m === 6 || m === 8)) {
      const r = 349;
      await tx({ kind: "REFUND", transactionDate: ds, amount: money(r), account: `card:${cards[2]}`, description: "Refund - Amazon return", merchantName: "Amazon", ...catOf("Shopping", "Online Shopping") });
      cardSpend[2] -= r;
      monthSpend.set(ymKey(d), (monthSpend.get(ymKey(d)) ?? 0) - r);
    }

    // Loan EMIs due today (paid from each loan's repayment bank)
    for (const s of emisByDate.get(ds) ?? []) {
      const li = loans.indexOf(s.loanId);
      if (li === SKIP_EMI.loan && ds === SKIP_EMI.dueDate) continue;
      await recordLoanPayment(userId, s.loanId, { paymentType: "EMI", paymentDate: ds, amount: s.emiAmount.toFixed(2), account: `bank:${banks[LOANS[li].payFrom]}`, scheduleId: s.id }, meta);
      count++;
    }

    // Card statements: bill the cycle; pay on (or a couple of days before) the due date
    for (let c = 0; c < CARDS.length; c++) {
      if (dom !== CARDS[c].statementDay) continue;
      const amount = Math.round(cardSpend[c] * 100) / 100;
      cardSpend[c] = 0;
      if (amount <= 0) continue;
      let due = day(y, m, CARDS[c].paymentDueDay);
      if (due <= d) due = day(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, Math.min(CARDS[c].paymentDueDay, 28));
      const payOn = addDays(due, -int(0, 3));
      if (payOn <= today) pendingCardPayments.push({ date: iso(payOn), card: c, amount });
      lastStatement.set(c, { stmt: d, due, amount });
    }
    for (const p of pendingCardPayments.filter((x) => x.date === ds)) {
      const c = CARDS[p.card];
      await tx({ kind: "CARD_PAYMENT", transactionDate: ds, amount: money(p.amount), account: `bank:${banks[c.payFrom]}`, creditCardId: cards[p.card], description: `${c.bankName} ${c.cardName} card bill payment`, paymentMethod: "NET_BANKING" });
    }

    // Month-end net-worth snapshot
    if (addDays(d, 1).getUTCDate() === 1) await snapshot(d);
  }
  await snapshot(today);
  console.log(`✓ ${count} transactions and payments`);

  // Latest statement per card → paid ones show "Paid", unpaid ones show as dues on the dashboard and in Reminders
  for (const [card, s] of lastStatement) {
    await prisma.creditCard.update({
      where: { id: cards[card] },
      data: { lastStatementDate: s.stmt, totalAmountDue: new Prisma.Decimal(money(s.amount)), minimumAmountDue: new Prisma.Decimal(money(Math.max(200, s.amount * 0.05))), currentDueDate: s.due },
    });
  }

  // Budgets
  await saveBudget(userId, null, { name: "All spending", amount: "15000", alertThresholdPct: 85 }, meta);
  await saveBudget(userId, null, { name: "Food", ...catOf("Food"), amount: "4500" }, meta);
  await saveBudget(userId, null, { name: "Transport", ...catOf("Transport"), amount: "2000" }, meta);
  await saveBudget(userId, null, { name: "Shopping", ...catOf("Shopping"), amount: "1500", alertThresholdPct: 75 }, meta);

  // Reminders
  const next = (dd: number) => iso(addDays(today, dd));
  await saveReminder(userId, null, { type: "INSURANCE", title: "Star Health insurance premium", amount: "18450", dueDate: next(4), recurrence: "YEARLY", leadDays: 7 }, meta);
  await saveReminder(userId, null, { type: "INSURANCE", title: "LIC policy premium", amount: "12600", dueDate: next(40), recurrence: "HALF_YEARLY", leadDays: 10 }, meta);
  await saveReminder(userId, null, { type: "BILL", title: "Property tax (BBMP)", amount: "6200", dueDate: next(-2), leadDays: 5 }, meta);
  await saveReminder(userId, null, { type: "CUSTOM", title: "Renew car PUC certificate", dueDate: next(12), recurrence: "HALF_YEARLY", leadDays: 3 }, meta);

  // Recurring payments: detect and confirm what was found
  await detectRecurringForUser(userId);
  const recurring = await prisma.recurringTransaction.findMany({ where: { userId } });
  for (const r of recurring) await updateRecurring(userId, r.id, { status: "CONFIRMED" }).catch(() => undefined);

  const notes = await generateNotificationsForUser(userId);

  // Summary
  const months = [...monthSpend.entries()].sort();
  console.log("✓ Monthly everyday spending (cap ₹15,000):");
  for (const [k, v] of months) console.log(`    ${k}: ₹${Math.round(v).toLocaleString("en-IN")}`);
  const nw = (await currentNetWorth(userId)).netWorth;
  console.log(`✓ Net worth today: ₹${nw.netWorth.toFixed(0)} (assets ₹${nw.totalAssets.toFixed(0)}, liabilities ₹${nw.totalLiabilities.toFixed(0)})`);
  console.log(`✓ ${recurring.length} recurring payments confirmed, 4 budgets, 4 reminders, ${notes.created} notifications`);
  console.log(`\nSign in at http://localhost:3010 with  ${TEST_EMAIL}  /  ${TEST_PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
