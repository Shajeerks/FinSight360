import "server-only";
import type { InstrumentType, InvestmentHolding, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/security/request";
import { Decimal, roundMoney, toDecimal } from "@/lib/money";
import { cashFlowsOf, computePosition, instrumentKeyOf, parseAmfiNav, PositionError, valueHolding, xirr, type CashFlow, type InvTxn } from "@/lib/investments/calc";
import { holdingSchema, investmentAccountSchema, investmentTxnSchema, priceUpdateSchema } from "@/validators/investments";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const todayUtc = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

// ───────────────────────────── accounts ─────────────────────────────

async function ownedAccount(db: Db, userId: string, id: string) {
  assertIds(id);
  const a = await db.investmentAccount.findFirst({ where: { id, userId, deletedAt: null } });
  if (!a) throw new NotFoundError("Investment account not found.");
  return a;
}

export async function createInvestmentAccount(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(investmentAccountSchema, input);
  const a = await prisma.investmentAccount.create({ data: { userId, ...d, providerName: d.providerName ?? (d.providerType === "GROWW" ? "Groww" : null) } });
  await audit({ userId, action: AuditAction.INVESTMENT_ACCOUNT_CREATED, entityType: "InvestmentAccount", entityId: a.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider: d.providerType } });
  return a;
}

export async function updateInvestmentAccount(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(investmentAccountSchema, input);
  await ownedAccount(prisma, userId, id);
  const a = await prisma.investmentAccount.update({ where: { id }, data: d });
  await audit({ userId, action: AuditAction.INVESTMENT_ACCOUNT_UPDATED, entityType: "InvestmentAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
  return a;
}

/** Soft delete — holdings and history are hidden with it (and drop out of net worth). */
export async function deleteInvestmentAccount(userId: string, id: string, meta: RequestMeta = NO_META) {
  await ownedAccount(prisma, userId, id);
  const now = new Date();
  await prisma.$transaction([
    prisma.investmentAccount.update({ where: { id }, data: { deletedAt: now, status: "CLOSED" } }),
    prisma.investmentHolding.updateMany({ where: { investmentAccountId: id, deletedAt: null }, data: { deletedAt: now } }),
    prisma.investmentTransaction.updateMany({ where: { investmentAccountId: id, deletedAt: null }, data: { deletedAt: now } }),
  ]);
  await audit({ userId, action: AuditAction.INVESTMENT_ACCOUNT_DELETED, entityType: "InvestmentAccount", entityId: id, ip: meta.ip, userAgent: meta.userAgent });
}

// ───────────────────────────── holdings ─────────────────────────────

async function ownedHolding(db: Db, userId: string, id: string) {
  assertIds(id);
  const h = await db.investmentHolding.findFirst({ where: { id, userId, deletedAt: null, investmentAccount: { deletedAt: null } } });
  if (!h) throw new NotFoundError("Holding not found.");
  return h;
}

async function lockHolding(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "investment_holdings" WHERE id = ${id} FOR UPDATE`;
}

function currentValueOf(qty: Decimal, price: Prisma.Decimal | null | undefined, fallback: Prisma.Decimal | null | undefined, invested: Decimal) {
  if (price !== null && price !== undefined) return roundMoney(qty.times(price));
  return fallback !== null && fallback !== undefined ? roundMoney(toDecimal(fallback)) : invested;
}

/**
 * Re-derive a holding from its transactions (when it has any). A holding with
 * no transactions is a snapshot the user (or a holdings file) entered directly.
 */
export async function recomputeHolding(tx: Tx, holdingId: string) {
  const h = await tx.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } });
  const txns = await tx.investmentTransaction.findMany({ where: { holdingId, deletedAt: null }, orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }] });
  if (!txns.length) return h;
  let p;
  try {
    p = computePosition(txns as InvTxn[]);
  } catch (e) {
    if (e instanceof PositionError) throw new AppError(e.message, 400, "OVERSOLD", { quantity: [e.message] });
    throw e;
  }
  return tx.investmentHolding.update({
    where: { id: holdingId },
    data: {
      quantity: p.quantity,
      averageBuyPrice: p.averageBuyPrice,
      investedAmount: p.investedAmount,
      realizedGainLoss: p.realizedGainLoss.plus(p.dividends),
      currentValue: currentValueOf(p.quantity, h.currentPrice, null, p.investedAmount),
    },
  });
}

export async function createHolding(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(holdingSchema, input);
  return prisma.$transaction(async (tx) => {
    await ownedAccount(tx, userId, d.investmentAccountId);
    const key = instrumentKeyOf(d);
    const qty = toDecimal(d.quantity);
    const invested = d.investedAmount ? roundMoney(toDecimal(d.investedAmount)) : roundMoney(qty.times(d.averageBuyPrice!));
    const avg = d.averageBuyPrice ? toDecimal(d.averageBuyPrice) : invested.dividedBy(qty).toDecimalPlaces(4);
    const price = d.currentPrice ? toDecimal(d.currentPrice) : null;
    const existing = await tx.investmentHolding.findUnique({ where: { investmentAccountId_instrumentKey: { investmentAccountId: d.investmentAccountId, instrumentKey: key } } });
    if (existing && !existing.deletedAt) throw new AppError("This fund/stock is already in this account — add a transaction to it instead.", 409, "HOLDING_EXISTS", { instrumentName: ["Already in this account"] });
    const data = {
      instrumentName: d.instrumentName, instrumentType: d.instrumentType, isin: d.isin, symbol: d.symbol, quantity: qty, averageBuyPrice: avg, investedAmount: invested,
      currentPrice: price, currentValue: currentValueOf(qty, price, null, invested), lastPricedAt: price ? new Date() : null, realizedGainLoss: new Decimal(0), deletedAt: null,
    };
    const h = existing
      ? await tx.investmentHolding.update({ where: { id: existing.id }, data })
      : await tx.investmentHolding.create({ data: { userId, investmentAccountId: d.investmentAccountId, instrumentKey: key, ...data } });
    if (existing) await tx.investmentTransaction.updateMany({ where: { holdingId: h.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (price) await recordPrice(tx, key, price, "MANUAL", userId);
    await audit({ userId, action: AuditAction.INVESTMENT_HOLDING_SAVED, entityType: "InvestmentHolding", entityId: h.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { mode: "snapshot" } }, tx);
    return h;
  });
}

/** Edit a snapshot holding's position; for holdings with transactions only the name/identifiers can change. */
export async function updateHolding(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(holdingSchema, input);
  return prisma.$transaction(async (tx) => {
    await lockHolding(tx, id);
    const h = await ownedHolding(tx, userId, id);
    const txCount = await tx.investmentTransaction.count({ where: { holdingId: id, deletedAt: null } });
    const key = instrumentKeyOf(d);
    if (key !== h.instrumentKey) {
      const clash = await tx.investmentHolding.findFirst({ where: { investmentAccountId: h.investmentAccountId, instrumentKey: key, id: { not: id } } });
      if (clash) throw new AppError("Another holding in this account already uses that ISIN/symbol.", 409, "HOLDING_EXISTS");
    }
    const base = { instrumentName: d.instrumentName, instrumentType: d.instrumentType, isin: d.isin, symbol: d.symbol, instrumentKey: key };
    let updated: InvestmentHolding;
    if (txCount) {
      updated = await tx.investmentHolding.update({ where: { id }, data: base });
    } else {
      const qty = toDecimal(d.quantity);
      const invested = d.investedAmount ? roundMoney(toDecimal(d.investedAmount)) : roundMoney(qty.times(d.averageBuyPrice!));
      const avg = d.averageBuyPrice ? toDecimal(d.averageBuyPrice) : invested.dividedBy(qty).toDecimalPlaces(4);
      const price = d.currentPrice ? toDecimal(d.currentPrice) : h.currentPrice;
      updated = await tx.investmentHolding.update({
        where: { id },
        data: { ...base, quantity: qty, averageBuyPrice: avg, investedAmount: invested, currentPrice: price, currentValue: currentValueOf(qty, price, null, invested), ...(d.currentPrice ? { lastPricedAt: new Date() } : {}) },
      });
    }
    await audit({ userId, action: AuditAction.INVESTMENT_HOLDING_SAVED, entityType: "InvestmentHolding", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { mode: txCount ? "details" : "snapshot" } }, tx);
    return updated;
  });
}

export async function deleteHolding(userId: string, id: string, meta: RequestMeta = NO_META) {
  await prisma.$transaction(async (tx) => {
    await ownedHolding(tx, userId, id);
    const now = new Date();
    await tx.investmentHolding.update({ where: { id }, data: { deletedAt: now } });
    await tx.investmentTransaction.updateMany({ where: { holdingId: id, deletedAt: null }, data: { deletedAt: now } });
    await audit({ userId, action: AuditAction.INVESTMENT_HOLDING_DELETED, entityType: "InvestmentHolding", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

/** ownerKey "" = public price (AMFI); otherwise the price is private to that user. */
export async function recordPrice(tx: Tx, instrumentKey: string, price: Decimal, source: string, ownerKey: string, date = todayUtc()) {
  await tx.investmentPrice.upsert({
    where: { instrumentKey_priceDate_source_ownerKey: { instrumentKey, priceDate: date, source, ownerKey } },
    update: { price },
    create: { instrumentKey, priceDate: date, price, source, ownerKey },
  });
}

export async function updateHoldingPrice(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(priceUpdateSchema, input);
  return prisma.$transaction(async (tx) => {
    await lockHolding(tx, id);
    const h = await ownedHolding(tx, userId, id);
    const price = toDecimal(d.currentPrice);
    await recordPrice(tx, h.instrumentKey, price, "MANUAL", userId);
    const u = await tx.investmentHolding.update({ where: { id }, data: { currentPrice: price, currentValue: roundMoney(h.quantity.times(price)), lastPricedAt: new Date() } });
    await audit({ userId, action: AuditAction.INVESTMENT_PRICES_UPDATED, entityType: "InvestmentHolding", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { source: "MANUAL" } }, tx);
    return u;
  });
}

// ───────────────────────────── transactions ─────────────────────────────

/** Find or create the holding a transaction belongs to. */
async function holdingFor(tx: Tx, userId: string, accountId: string, i: { holdingId?: string | null; instrumentName?: string | null; instrumentType?: InstrumentType | null; isin?: string | null; symbol?: string | null }) {
  if (i.holdingId) {
    const h = await ownedHolding(tx, userId, i.holdingId);
    if (h.investmentAccountId !== accountId) throw new AppError("That holding belongs to another account.", 400, "INVALID_HOLDING");
    return h;
  }
  const key = instrumentKeyOf({ instrumentName: i.instrumentName!, isin: i.isin, symbol: i.symbol });
  const existing = await tx.investmentHolding.findUnique({ where: { investmentAccountId_instrumentKey: { investmentAccountId: accountId, instrumentKey: key } } });
  if (existing) {
    if (existing.deletedAt) {
      // Re-buying something previously removed starts a fresh history.
      await tx.investmentTransaction.updateMany({ where: { holdingId: existing.id, deletedAt: null }, data: { deletedAt: new Date() } });
      return tx.investmentHolding.update({ where: { id: existing.id }, data: { deletedAt: null, quantity: 0, averageBuyPrice: 0, investedAmount: 0, realizedGainLoss: 0, currentValue: 0 } });
    }
    return existing;
  }
  return tx.investmentHolding.create({
    data: { userId, investmentAccountId: accountId, instrumentKey: key, instrumentName: i.instrumentName!, instrumentType: i.instrumentType ?? "OTHER", isin: i.isin ?? null, symbol: i.symbol ?? null, quantity: 0, averageBuyPrice: 0, investedAmount: 0 },
  });
}

/** Marker id of the auto-created opening BUY (an imported full history replaces it). */
export const openingIdOf = (holdingId: string) => `OPENING:${holdingId}`;

/** A snapshot holding that starts getting transactions keeps its position as an opening BUY. */
async function ensureOpeningPosition(tx: Tx, userId: string, h: InvestmentHolding) {
  const count = await tx.investmentTransaction.count({ where: { holdingId: h.id, deletedAt: null } });
  if (count || h.quantity.lessThanOrEqualTo(0)) return;
  await tx.investmentTransaction.create({
    data: {
      userId, investmentAccountId: h.investmentAccountId, holdingId: h.id, type: "BUY",
      tradeDate: new Date(Date.UTC(h.createdAt.getUTCFullYear(), h.createdAt.getUTCMonth(), h.createdAt.getUTCDate())),
      quantity: h.quantity, price: h.averageBuyPrice, amount: h.investedAmount, notes: "Opening position (entered as a holding)",
      sourceType: "MANUAL", externalId: openingIdOf(h.id),
    },
  });
}

export async function addInvestmentTransaction(userId: string, input: unknown, meta: RequestMeta = NO_META) {
  const d = parseOrThrow(investmentTxnSchema, input);
  return prisma.$transaction(async (tx) => {
    await ownedAccount(tx, userId, d.investmentAccountId);
    const h = await holdingFor(tx, userId, d.investmentAccountId, d);
    await lockHolding(tx, h.id);
    await ensureOpeningPosition(tx, userId, h);
    const qty = toDecimal(d.quantity);
    const amount = d.amount ? toDecimal(d.amount) : d.price ? roundMoney(qty.times(d.price)) : new Decimal(0);
    const price = d.price ? toDecimal(d.price) : qty.isZero() ? new Decimal(0) : amount.dividedBy(qty).toDecimalPlaces(4);
    const t = await tx.investmentTransaction.create({
      data: { userId, investmentAccountId: d.investmentAccountId, holdingId: h.id, type: d.type, tradeDate: d.tradeDate, quantity: qty, price, amount, charges: toDecimal(d.charges), notes: d.notes },
    });
    await recomputeHolding(tx, h.id);
    await audit({ userId, action: AuditAction.INVESTMENT_TXN_CREATED, entityType: "InvestmentTransaction", entityId: t.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { type: d.type } }, tx);
    return t;
  });
}

export async function deleteInvestmentTransaction(userId: string, id: string, meta: RequestMeta = NO_META) {
  assertIds(id);
  await prisma.$transaction(async (tx) => {
    const t = await tx.investmentTransaction.findFirst({ where: { id, userId, deletedAt: null } });
    if (!t) throw new NotFoundError("Transaction not found.");
    if (t.holdingId) await lockHolding(tx, t.holdingId);
    await tx.investmentTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    if (t.holdingId) {
      const left = await tx.investmentTransaction.count({ where: { holdingId: t.holdingId, deletedAt: null } });
      if (left) await recomputeHolding(tx, t.holdingId);
      else await tx.investmentHolding.update({ where: { id: t.holdingId }, data: { quantity: 0, averageBuyPrice: 0, investedAmount: 0, realizedGainLoss: 0, currentValue: 0 } });
    }
    await audit({ userId, action: AuditAction.INVESTMENT_TXN_DELETED, entityType: "InvestmentTransaction", entityId: id, ip: meta.ip, userAgent: meta.userAgent }, tx);
  });
}

// ───────────────────────────── NAV refresh (AMFI) ─────────────────────────────

export const AMFI_NAV_URL = () => process.env.AMFI_NAV_URL || "https://www.amfiindia.com/spages/NAVAll.txt";

/** Updates every mutual-fund holding with an ISIN from AMFI's public daily NAV file. */
export async function refreshMutualFundNavs(userId: string, meta: RequestMeta = NO_META, fetchText: (url: string) => Promise<string> = defaultFetchText) {
  const holdings = await prisma.investmentHolding.findMany({ where: { userId, deletedAt: null, investmentAccount: { deletedAt: null }, isin: { not: null }, instrumentType: { in: ["MUTUAL_FUND", "ETF"] } } });
  if (!holdings.length) return { updated: 0, notFound: 0, asOf: null as string | null };
  let text: string;
  try {
    text = await fetchText(AMFI_NAV_URL());
  } catch {
    throw new AppError("Couldn't download today's NAVs from AMFI. Check your internet connection and try again.", 502, "NAV_UNAVAILABLE");
  }
  const navs = parseAmfiNav(text);
  if (!navs.size) throw new AppError("The NAV file from AMFI couldn't be read.", 502, "NAV_UNREADABLE");
  let updated = 0;
  let latest: Date | null = null;
  await prisma.$transaction(async (tx) => {
    for (const h of holdings) {
      const n = navs.get(h.isin!);
      if (!n) continue;
      const price = toDecimal(n.nav);
      await recordPrice(tx, h.instrumentKey, price, "AMFI", "", n.date);
      await tx.investmentHolding.update({ where: { id: h.id }, data: { currentPrice: price, currentValue: roundMoney(h.quantity.times(price)), lastPricedAt: n.date } });
      updated++;
      if (!latest || n.date > latest) latest = n.date;
    }
  });
  await audit({ userId, action: AuditAction.INVESTMENT_PRICES_UPDATED, entityType: "InvestmentHolding", ip: meta.ip, userAgent: meta.userAgent, metadata: { source: "AMFI", updated } });
  return { updated, notFound: holdings.length - updated, asOf: (latest as Date | null)?.toISOString().slice(0, 10) ?? null };
}

async function defaultFetchText(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "FinSight360/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ───────────────────────────── portfolio ─────────────────────────────

const TYPE_LABEL: Record<string, string> = { MUTUAL_FUND: "Mutual funds", STOCK: "Stocks", ETF: "ETFs", BOND: "Bonds", FIXED_DEPOSIT: "Fixed deposits", GOLD: "Gold", OTHER: "Other" };
export { TYPE_LABEL as INSTRUMENT_TYPE_LABEL };

export async function getPortfolio(userId: string) {
  const accounts = await prisma.investmentAccount.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      holdings: { where: { deletedAt: null }, orderBy: { instrumentName: "asc" }, include: { transactions: { where: { deletedAt: null }, orderBy: { tradeDate: "asc" } } } },
      groww: { select: { lastSyncAt: true, method: true } },
    },
  });
  const today = todayUtc();
  let invested = new Decimal(0);
  let current = new Decimal(0);
  let realized = new Decimal(0);
  const allFlows: CashFlow[] = [];
  let xirrHoldings = 0;
  const byType = new Map<string, { invested: Decimal; current: Decimal }>();

  const accountViews = accounts.map((a) => {
    let aInv = new Decimal(0);
    let aCur = new Decimal(0);
    const holdings = a.holdings
      .filter((h) => h.quantity.greaterThan(0) || h.transactions.length)
      .map((h) => {
        const v = valueHolding(h);
        // XIRR needs real dates: only holdings with a transaction history take part.
        const flows = h.transactions.length ? cashFlowsOf(h.transactions as unknown as InvTxn[]) : [];
        const withValue = v.current.greaterThan(0) ? [...flows, { date: today, amount: v.current.toNumber() }] : flows;
        if (h.transactions.length) {
          xirrHoldings++;
          allFlows.push(...withValue);
        }
        aInv = aInv.plus(v.invested);
        aCur = aCur.plus(v.current);
        realized = realized.plus(h.realizedGainLoss);
        const t = byType.get(h.instrumentType) ?? { invested: new Decimal(0), current: new Decimal(0) };
        byType.set(h.instrumentType, { invested: t.invested.plus(v.invested), current: t.current.plus(v.current) });
        return {
          id: h.id,
          instrumentName: h.instrumentName,
          instrumentType: h.instrumentType,
          isin: h.isin,
          symbol: h.symbol,
          quantity: h.quantity,
          averageBuyPrice: h.averageBuyPrice,
          currentPrice: h.currentPrice,
          lastPricedAt: h.lastPricedAt,
          realized: h.realizedGainLoss,
          transactions: h.transactions.length,
          ...v,
          xirr: h.transactions.length ? xirr(withValue) : null,
        };
      })
      .sort((x, y) => y.current.comparedTo(x.current));
    invested = invested.plus(aInv);
    current = current.plus(aCur);
    return { id: a.id, name: a.name, providerType: a.providerType, providerName: a.providerName, accountType: a.accountType, lastImportAt: a.groww?.lastSyncAt ?? null, invested: roundMoney(aInv), current: roundMoney(aCur), gain: roundMoney(aCur.minus(aInv)), holdings };
  });

  invested = roundMoney(invested);
  current = roundMoney(current);
  const gain = roundMoney(current.minus(invested));
  const overallXirr = xirr(allFlows);

  // One snapshot per day for the history chart.
  if (accounts.length) {
    const existing = await prisma.portfolioSnapshot.findFirst({ where: { userId, investmentAccountId: null, snapshotDate: today } });
    if (existing) await prisma.portfolioSnapshot.update({ where: { id: existing.id }, data: { investedAmount: invested, currentValue: current } });
    else await prisma.portfolioSnapshot.create({ data: { userId, snapshotDate: today, investedAmount: invested, currentValue: current } });
  }
  const history = await prisma.portfolioSnapshot.findMany({ where: { userId, investmentAccountId: null }, orderBy: { snapshotDate: "asc" }, take: 400 });
  const all = accountViews.flatMap((a) => a.holdings.map((h) => ({ ...h, account: a.name })));
  const movers = all.filter((h) => h.gainPct !== null && h.current.greaterThan(0)).sort((x, y) => y.gainPct!.comparedTo(x.gainPct!));

  return {
    totals: { invested, current, gain, gainPct: invested.isZero() ? null : gain.dividedBy(invested).times(100).toDecimalPlaces(2), realized: roundMoney(realized), xirr: overallXirr, xirrHoldings, holdings: all.length },
    allocation: [...byType.entries()]
      .map(([type, v]) => ({ type, label: TYPE_LABEL[type] ?? type, invested: roundMoney(v.invested), current: roundMoney(v.current), pct: current.isZero() ? 0 : v.current.dividedBy(current).times(100).toDecimalPlaces(1).toNumber() }))
      .sort((a, b) => b.current.comparedTo(a.current)),
    accounts: accountViews,
    topGainers: movers.slice(0, 3),
    topLosers: movers.slice(-3).reverse().filter((m) => m.gain.lessThan(0)),
    history: history.map((s) => ({ date: s.snapshotDate.toISOString().slice(0, 10), invested: s.investedAmount.toNumber(), current: s.currentValue.toNumber() })),
  };
}

export type Portfolio = Awaited<ReturnType<typeof getPortfolio>>;

export async function getHoldingDetail(userId: string, id: string) {
  const h = await ownedHolding(prisma, userId, id);
  const [account, transactions, prices] = await Promise.all([
    prisma.investmentAccount.findUniqueOrThrow({ where: { id: h.investmentAccountId }, select: { id: true, name: true } }),
    prisma.investmentTransaction.findMany({ where: { holdingId: id, deletedAt: null }, orderBy: [{ tradeDate: "desc" }, { createdAt: "desc" }] }),
    prisma.investmentPrice.findMany({ where: { instrumentKey: h.instrumentKey, ownerKey: { in: ["", userId] } }, orderBy: { priceDate: "asc" }, take: 400 }),
  ]);
  const v = valueHolding(h);
  const flows = cashFlowsOf([...transactions].reverse() as unknown as InvTxn[]);
  return {
    holding: h,
    account,
    value: v,
    xirr: transactions.length && v.current.greaterThan(0) ? xirr([...flows, { date: todayUtc(), amount: v.current.toNumber() }]) : null,
    transactions,
    prices: prices.map((p) => ({ date: p.priceDate.toISOString().slice(0, 10), price: p.price.toNumber(), source: p.source })),
  };
}

export async function investmentFormOptions(userId: string) {
  const accounts = await prisma.investmentAccount.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, providerType: true, holdings: { where: { deletedAt: null }, orderBy: { instrumentName: "asc" }, select: { id: true, instrumentName: true, instrumentType: true } } },
  });
  return accounts;
}

export type InvestmentFormOptions = Awaited<ReturnType<typeof investmentFormOptions>>;
