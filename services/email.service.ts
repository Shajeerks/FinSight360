import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { EmailConnection, EmailTransactionCandidate, Prisma, SourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertIds, parseOrThrow } from "@/lib/api";
import { audit, AuditAction } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RequestMeta } from "@/lib/security/request";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { parseBankAlert, type ParsedEmailTxn } from "@/lib/email/parse";
import { mailProvider, MailAuthError, type MailProviderName, type TokenSet } from "@/lib/email/providers";
import { loadRulesForMatching } from "@/services/rule.service";
import { collectAffected, emptyAffected, lockForWrite, recomputeAffected } from "@/services/ledger-balance.service";
import { attachToExisting, createIngestedTransaction, findDuplicate, merchantFor, suggestCategory, type AccountRef, type IngestRow } from "@/services/ingestion.service";
import { emailCandidateDecisionSchema, emailParsePreviewSchema, emailSyncSchema } from "@/validators/email";

const NO_META: RequestMeta = { ip: null, userAgent: null };
type Tx = Prisma.TransactionClient;

/** Alerts at or above this confidence (known bank sender, account identified) count immediately. */
export const EMAIL_AUTO_CONFIRM = 85;
export const MAX_MESSAGES_PER_SYNC = 300;
const STATE_TTL_MS = 10 * 60_000;

export const PROVIDER_LABEL: Record<MailProviderName, string> = { GMAIL: "Gmail", OUTLOOK: "Outlook" };

function redirectUri(provider: MailProviderName) {
  return `${env().APP_URL}/api/email/callback/${provider.toLowerCase()}`;
}

export function providerFromParam(p: string): MailProviderName {
  if (p === "gmail") return "GMAIL";
  if (p === "outlook") return "OUTLOOK";
  throw new NotFoundError("Unknown email provider.");
}

function requireEncryptionKey() {
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    throw new AppError("TOKEN_ENCRYPTION_KEY is not set. Run `npm run setup:env` (or add it to .env) and restart.", 503, "ENCRYPTION_NOT_CONFIGURED");
  }
}

// ───────────────────────────── OAuth connect ─────────────────────────────

/**
 * Starts the consent flow. The state + PKCE verifier live in an encrypted,
 * short-lived httpOnly cookie bound to this user — the callback rejects
 * anything that doesn't match.
 */
export function startConnect(userId: string, provider: MailProviderName) {
  const p = mailProvider(provider);
  if (!p.configured()) {
    throw new AppError(
      `${PROVIDER_LABEL[provider]} isn't set up on this FinSight360 instance yet. Add ${provider === "GMAIL" ? "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET" : "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET"} to .env (see README → Email sync).`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }
  requireEncryptionKey();
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const cookie = encryptSecret(JSON.stringify({ s: state, v: verifier, u: userId, p: provider, t: Date.now() + STATE_TTL_MS }));
  return { url: p.authUrl({ state, codeChallenge: challenge, redirectUri: redirectUri(provider) }), cookie };
}

export async function completeConnect(
  userId: string,
  provider: MailProviderName,
  q: { code: string | null; state: string | null; error: string | null; cookie: string | undefined },
  meta: RequestMeta = NO_META,
) {
  if (q.error) throw new AppError(q.error === "access_denied" ? "You declined access — nothing was connected." : "The provider reported an error. Please try again.", 400, "OAUTH_DENIED");
  let saved: { s: string; v: string; u: string; p: string; t: number } | null = null;
  try {
    saved = q.cookie ? JSON.parse(decryptSecret(q.cookie)) : null;
  } catch {
    saved = null;
  }
  if (!saved || !q.state || saved.s !== q.state || saved.u !== userId || saved.p !== provider || saved.t < Date.now() || !q.code) {
    throw new AppError("This connection link expired or didn't match. Start again from Email Sync.", 400, "OAUTH_STATE");
  }
  const p = mailProvider(provider);
  const tokens = await p.exchangeCode({ code: q.code, codeVerifier: saved.v, redirectUri: redirectUri(provider) });
  const emailAddress = await p.profileEmail(tokens.accessToken);
  if (!emailAddress) throw new AppError("Couldn't read the mailbox address.", 400, "OAUTH_PROFILE");
  const existing = await prisma.emailConnection.findUnique({ where: { userId_provider_emailAddress: { userId, provider, emailAddress } } });
  const refreshTokenEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : (existing?.refreshTokenEnc ?? null);
  const conn = await prisma.emailConnection.upsert({
    where: { userId_provider_emailAddress: { userId, provider, emailAddress } },
    update: { status: "ACTIVE", accessTokenEnc: encryptSecret(tokens.accessToken), refreshTokenEnc, tokenExpiresAt: tokens.expiresAt, scopes: tokens.scope ?? p.scopes, lastError: null },
    create: { userId, provider, emailAddress, status: "ACTIVE", accessTokenEnc: encryptSecret(tokens.accessToken), refreshTokenEnc, tokenExpiresAt: tokens.expiresAt, scopes: tokens.scope ?? p.scopes },
  });
  await audit({ userId, action: AuditAction.EMAIL_CONNECTED, entityType: "EmailConnection", entityId: conn.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider, reconnect: Boolean(existing) } });
  return conn;
}

async function freshAccessToken(conn: EmailConnection): Promise<string> {
  requireEncryptionKey();
  if (conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) return decryptSecret(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) throw new MailAuthError("No refresh token");
  const t: TokenSet = await mailProvider(conn.provider).refresh(decryptSecret(conn.refreshTokenEnc));
  // Conditional write: a disconnect that happened meanwhile must win (tokens stay wiped).
  const saved = await prisma.emailConnection.updateMany({
    where: { id: conn.id, status: { not: "DISCONNECTED" } },
    data: { accessTokenEnc: encryptSecret(t.accessToken), tokenExpiresAt: t.expiresAt, ...(t.refreshToken ? { refreshTokenEnc: encryptSecret(t.refreshToken) } : {}) },
  });
  if (!saved.count) throw new AppError("This mailbox was disconnected.", 409, "DISCONNECTED");
  return t.accessToken;
}

async function ownedConnection(userId: string, id: string) {
  assertIds(id);
  const c = await prisma.emailConnection.findFirst({ where: { id, userId } });
  if (!c) throw new NotFoundError("Email connection not found.");
  return c;
}

export async function disconnectEmail(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  const { deleteData } = parseOrThrow(emailSyncSchema.pick({ deleteData: true }), input ?? {});
  const conn = await ownedConnection(userId, id);
  try {
    const token = conn.refreshTokenEnc ? decryptSecret(conn.refreshTokenEnc) : conn.accessTokenEnc ? decryptSecret(conn.accessTokenEnc) : null;
    if (token) await mailProvider(conn.provider).revoke(token);
  } catch (e) {
    logger.warn("email_revoke_failed", { provider: conn.provider, error: e });
  }
  if (deleteData) {
    // Transactions already in the ledger stay; only the email bookkeeping is removed.
    await prisma.emailConnection.delete({ where: { id: conn.id } });
  } else {
    await prisma.emailConnection.update({ where: { id: conn.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null } });
  }
  await audit({ userId, action: AuditAction.EMAIL_DISCONNECTED, entityType: "EmailConnection", entityId: conn.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { provider: conn.provider, deleteData } });
}

// ───────────────────────────── account resolution & ingestion ─────────────────────────────

type Resolution = { account: AccountRef | null; creditCardId: string | null; note: string | null };

/** Map the last digits in an alert to ONE of the user's accounts/cards (never guesses between several). */
export async function resolveAlertAccount(db: Tx | typeof prisma, userId: string, c: Pick<EmailTransactionCandidate, "accountLast4" | "cardLast4" | "transactionType" | "description">): Promise<Resolution> {
  const isDebitCard = /DEBIT CARD/i.test(c.description ?? "");
  let creditCardId: string | null = null;
  if (c.cardLast4 && !isDebitCard) {
    const cards = await db.creditCard.findMany({ where: { userId, deletedAt: null, last4: c.cardLast4 }, select: { id: true } });
    if (cards.length === 1) creditCardId = cards[0].id;
  }
  if (c.accountLast4) {
    const banks = await db.bankAccount.findMany({ where: { userId, deletedAt: null, last4: { endsWith: c.accountLast4 } }, select: { id: true } });
    if (banks.length === 1) return { account: { kind: "bank", id: banks[0].id }, creditCardId: c.transactionType === "CARD_PAYMENT" ? creditCardId : null, note: null };
    return { account: null, creditCardId: null, note: banks.length ? `More than one account ends in ${c.accountLast4}` : `No account ending ${c.accountLast4} — add its last 4 digits to the account, or choose one` };
  }
  if (creditCardId) return { account: { kind: "card", id: creditCardId }, creditCardId: null, note: null };
  if (c.cardLast4) return { account: null, creditCardId: null, note: isDebitCard ? `Debit card ending ${c.cardLast4} — choose the bank account it belongs to` : `No credit card ending ${c.cardLast4}` };
  return { account: null, creditCardId: null, note: "The alert didn't say which account — choose one" };
}

/**
 * Turns an email candidate into ledger state through the shared ingestion
 * pipeline: link to an existing transaction (high-confidence duplicate), create
 * a pending possible duplicate, or create a new transaction.
 */
async function ingestCandidate(tx: Tx, userId: string, c: EmailTransactionCandidate & { emailMessage: { providerMessageId: string; connection: { provider: MailProviderName } } }, forced?: AccountRef) {
  const resolved = forced ? { account: forced, creditCardId: null, note: null } : await resolveAlertAccount(tx, userId, c);
  if (!resolved.account) return { outcome: "NEEDS_ACCOUNT" as const, note: resolved.note };
  let creditCardId = resolved.creditCardId;
  if (forced && c.transactionType === "CARD_PAYMENT" && forced.kind === "bank" && c.cardLast4) {
    creditCardId = (await tx.creditCard.findFirst({ where: { userId, deletedAt: null, last4: c.cardLast4 }, select: { id: true } }))?.id ?? null;
  }
  const sourceType = c.emailMessage.connection.provider as SourceType;
  const externalId = `${sourceType}:${c.emailMessage.providerMessageId}`;
  const row: IngestRow = {
    account: resolved.account,
    transactionDate: c.transactionDate,
    transactionAt: c.transactionAt,
    amount: c.amount.toFixed(2),
    direction: c.direction,
    transactionType: c.transactionType,
    description: c.description ?? "Bank alert",
    merchantName: c.merchantName ?? merchantFor(c.transactionType, c.description ?? ""),
    referenceNumber: c.referenceNumber,
    creditCardId,
    categoryId: null,
    subCategoryId: null,
    confidence: Number(c.confidenceScore),
  };
  const affected = emptyAffected();
  collectAffected(affected, { bankAccountId: row.account.kind === "bank" ? row.account.id : null, creditCardId: row.account.kind === "card" ? row.account.id : creditCardId });
  await lockForWrite(tx, affected);

  const already = await tx.transactionSource.findFirst({ where: { userId, sourceType, externalId, transaction: { deletedAt: null } }, select: { transactionId: true } });
  if (already) {
    await tx.emailTransactionCandidate.update({ where: { id: c.id }, data: { status: "MERGED", transactionId: already.transactionId } });
    return { outcome: "ALREADY" as const, note: null };
  }
  const cat = await suggestCategory(tx, userId, await loadRulesForMatching(tx, userId), row);
  row.categoryId = cat.categoryId;
  row.subCategoryId = cat.subCategoryId;
  const source = { sourceType, externalId, emailMessageId: c.emailMessageId, rawDescription: row.description, confidence: row.confidence, metadata: { parser: c.parserId } };

  // Another alert already recorded as a transaction = a different real transaction (two coffees), so cap at review.
  const hit = await findDuplicate(tx, userId, row, new Set(), { sourceType: { in: ["GMAIL", "OUTLOOK"] } });
  if (hit?.verdict === "AUTO_MATCH") {
    const a = await attachToExisting(tx, userId, hit.transactionId, row, source);
    a.bank.forEach((x) => affected.bank.add(x));
    a.card.forEach((x) => affected.card.add(x));
    await tx.emailTransactionCandidate.update({ where: { id: c.id }, data: { status: "MERGED", transactionId: hit.transactionId, duplicateScore: hit.score } });
    await recomputeAffected(tx, affected);
    return { outcome: "LINKED" as const, note: null };
  }
  const possible = hit?.verdict === "REVIEW";
  const pending = possible || row.confidence < EMAIL_AUTO_CONFIRM;
  const t = await createIngestedTransaction(tx, userId, row, { status: pending ? "PENDING_REVIEW" : "CONFIRMED", duplicateStatus: possible ? "POSSIBLE_DUPLICATE" : "UNIQUE" }, source);
  if (possible) {
    await tx.transactionDuplicateCandidate.create({ data: { userId, transactionId: t.id, matchedTransactionId: hit!.transactionId, score: hit!.score, matchedFields: hit!.matchedFields } });
  }
  await tx.emailTransactionCandidate.update({ where: { id: c.id }, data: { status: "APPROVED", transactionId: t.id, duplicateScore: hit?.score ?? null } });
  collectAffected(affected, t);
  await recomputeAffected(tx, affected);
  return { outcome: possible ? ("POSSIBLE_DUPLICATE" as const) : pending ? ("PENDING" as const) : ("CREATED" as const), note: null };
}

const candidateInclude = { emailMessage: { select: { providerMessageId: true, connection: { select: { provider: true } } } } } as const;

// ───────────────────────────── sync ─────────────────────────────

export type SyncSummary = { fetched: number; transactions: number; linked: number; needsAccount: number; notFinancial: number; failed: number };

/**
 * Fetches new bank/card alerts since the last sync (or `days` back on the
 * first run), parses them, and runs them through the ingestion pipeline.
 * Message bodies are processed in memory only; we store a SHA-256 of the body.
 */
export async function syncEmailConnection(userId: string, connectionId: string, input: unknown = {}, meta: RequestMeta = NO_META): Promise<SyncSummary> {
  const { days } = parseOrThrow(emailSyncSchema, input ?? {});
  const conn = await ownedConnection(userId, connectionId);
  if (conn.status === "DISCONNECTED") throw new AppError("This mailbox is disconnected. Connect it again to sync.", 409, "DISCONNECTED");
  const running = await prisma.emailSyncJob.findFirst({ where: { connectionId: conn.id, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 10 * 60_000) } } });
  if (running) throw new AppError("A sync for this mailbox is already running.", 409, "SYNC_RUNNING");
  const job = await prisma.emailSyncJob.create({ data: { connectionId: conn.id, status: "RUNNING" } });
  const summary: SyncSummary = { fetched: 0, transactions: 0, linked: 0, needsAccount: 0, notFinancial: 0, failed: 0 };
  const startedAt = new Date();
  try {
    const client = mailProvider(conn.provider).client(await freshAccessToken(conn));
    const since = conn.lastSyncAt ? new Date(conn.lastSyncAt.getTime() - 2 * 86_400_000) : new Date(Date.now() - days * 86_400_000);
    const ids = await client.listBankMessageIds(since, MAX_MESSAGES_PER_SYNC);
    const known = new Set((await prisma.emailMessage.findMany({ where: { connectionId: conn.id, providerMessageId: { in: ids } }, select: { providerMessageId: true } })).map((m) => m.providerMessageId));
    for (const id of ids.filter((x) => !known.has(x)).reverse()) {
      // Stop promptly if the user disconnects while we're working.
      const current = await prisma.emailConnection.findUnique({ where: { id: conn.id }, select: { status: true } });
      if (!current || current.status === "DISCONNECTED") break;
      try {
        const mail = await client.getMessage(id);
        summary.fetched++;
        const parsed = parseBankAlert({ from: mail.from, subject: mail.subject, text: mail.text, receivedAt: mail.receivedAt });
        const msg = await prisma.emailMessage.create({
          data: {
            userId,
            connectionId: conn.id,
            providerMessageId: mail.id,
            threadId: mail.threadId,
            fromAddress: mail.from.slice(0, 200),
            subject: mail.subject.slice(0, 300),
            receivedAt: mail.receivedAt,
            bodySha256: createHash("sha256").update(mail.text).digest("hex"),
            parserId: parsed.ok ? parsed.txn.parserId : null,
            status: parsed.ok ? "PARSED" : "NOT_FINANCIAL",
            errorMessage: parsed.ok ? null : parsed.reason,
          },
        });
        if (!parsed.ok) {
          summary.notFinancial++;
          continue;
        }
        const outcome = await createAndIngest(userId, msg.id, parsed.txn);
        if (outcome === "NEEDS_ACCOUNT") summary.needsAccount++;
        else if (outcome === "LINKED" || outcome === "ALREADY") summary.linked++;
        else summary.transactions++;
      } catch (e) {
        if (e instanceof MailAuthError) throw e;
        summary.failed++;
        logger.warn("email_message_failed", { provider: conn.provider, error: e });
      }
    }
    await prisma.emailConnection.updateMany({ where: { id: conn.id, status: { not: "DISCONNECTED" } }, data: { lastSyncAt: startedAt, lastError: null, status: "ACTIVE" } });
    await prisma.emailSyncJob.update({
      where: { id: job.id },
      data: { status: summary.failed ? "PARTIAL" : "SUCCEEDED", finishedAt: new Date(), messagesFetched: summary.fetched, candidatesCreated: summary.transactions + summary.linked + summary.needsAccount, failedCount: summary.failed },
    });
    await audit({ userId, action: AuditAction.EMAIL_SYNCED, entityType: "EmailConnection", entityId: conn.id, ip: meta.ip, userAgent: meta.userAgent, metadata: summary });
    if (summary.transactions || summary.needsAccount) {
      const { notify } = await import("@/services/notification.service");
      await notify(userId, {
        type: "IMPORT",
        title: `${summary.transactions} transaction(s) from ${conn.emailAddress}`,
        body: summary.needsAccount ? `${summary.needsAccount} alert(s) need you to choose an account.` : "Added from your bank alerts.",
        link: summary.needsAccount ? "/imports/email" : "/transactions?source=" + conn.provider,
        dedupeKey: `email-sync:${job.id}`,
      }).catch(() => undefined);
    }
    return summary;
  } catch (e) {
    const expired = e instanceof MailAuthError;
    await prisma.emailConnection.updateMany({ where: { id: conn.id, status: { not: "DISCONNECTED" } }, data: { status: expired ? "EXPIRED" : "ERROR", lastError: expired ? "Access expired or was revoked — reconnect this mailbox." : "Sync failed — try again later." } });
    await prisma.emailSyncJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date(), errorMessage: expired ? "auth" : "provider", messagesFetched: summary.fetched } });
    if (expired) throw new AppError("Access to this mailbox expired or was revoked. Reconnect it.", 401, "RECONNECT_REQUIRED");
    if (e instanceof AppError) throw e;
    logger.error("email_sync_failed", { provider: conn.provider, error: e });
    throw new AppError("Couldn't reach the mail provider. Please try again later.", 502, "PROVIDER_UNAVAILABLE");
  }
}

async function createAndIngest(userId: string, emailMessageId: string, p: ParsedEmailTxn) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.emailTransactionCandidate.create({
      data: {
        userId,
        emailMessageId,
        parserId: p.parserId,
        transactionDate: p.transactionDate,
        transactionAt: p.transactionAt,
        amount: p.amount,
        direction: p.direction,
        transactionType: p.transactionType,
        merchantName: p.merchantName,
        accountLast4: p.accountLast4,
        cardLast4: p.cardLast4,
        referenceNumber: p.referenceNumber,
        description: p.instrument === "debit-card" ? `DEBIT CARD ${p.description}`.slice(0, 300) : p.description,
        confidenceScore: p.confidence,
      },
      include: candidateInclude,
    });
    return (await ingestCandidate(tx, userId, c)).outcome;
  });
}

/** Sync every active mailbox (used by the background script). */
export async function syncAllEmailConnections() {
  const conns = await prisma.emailConnection.findMany({ where: { status: { in: ["ACTIVE", "ERROR"] } }, select: { id: true, userId: true } });
  const results: { id: string; ok: boolean; summary?: SyncSummary; error?: string }[] = [];
  for (const c of conns) {
    try {
      results.push({ id: c.id, ok: true, summary: await syncEmailConnection(c.userId, c.id) });
    } catch (e) {
      results.push({ id: c.id, ok: false, error: e instanceof AppError ? e.code : "error" });
    }
  }
  return results;
}

// ───────────────────────────── review of unmatched alerts ─────────────────────────────

/** Alerts we parsed but couldn't place on an account. */
export async function listEmailCandidates(userId: string) {
  const rows = await prisma.emailTransactionCandidate.findMany({
    where: { userId, status: "PENDING_REVIEW" },
    orderBy: { transactionDate: "desc" },
    take: 200,
    include: { emailMessage: { select: { subject: true, fromAddress: true, receivedAt: true, connection: { select: { provider: true, emailAddress: true } } } } },
  });
  return Promise.all(rows.map(async (r) => ({ ...r, note: (await resolveAlertAccount(prisma, userId, r)).note })));
}

export type EmailCandidateItem = Awaited<ReturnType<typeof listEmailCandidates>>[number];

export async function resolveEmailCandidate(userId: string, id: string, input: unknown, meta: RequestMeta = NO_META) {
  assertIds(id);
  const d = parseOrThrow(emailCandidateDecisionSchema, input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "email_transaction_candidates" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.emailTransactionCandidate.findFirst({ where: { id, userId }, include: candidateInclude });
    if (!c) throw new NotFoundError("Alert not found.");
    if (c.status !== "PENDING_REVIEW") throw new AppError("This alert was already handled.", 409, "ALREADY_RESOLVED");
    let outcome: string = "REJECTED";
    if (d.action === "REJECT") {
      await tx.emailTransactionCandidate.update({ where: { id }, data: { status: "REJECTED" } });
    } else {
      const [kind, accId] = d.account!.split(":") as ["bank" | "card", string];
      const owned = kind === "bank"
        ? await tx.bankAccount.findFirst({ where: { id: accId, userId, deletedAt: null }, select: { id: true } })
        : await tx.creditCard.findFirst({ where: { id: accId, userId, deletedAt: null }, select: { id: true } });
      if (!owned) throw new AppError("Choose one of your accounts.", 400, "INVALID_ACCOUNT", { account: ["Choose one of your accounts"] });
      outcome = (await ingestCandidate(tx, userId, c, { kind, id: accId })).outcome;
    }
    await audit({ userId, action: AuditAction.EMAIL_CANDIDATE_RESOLVED, entityType: "EmailTransactionCandidate", entityId: id, ip: meta.ip, userAgent: meta.userAgent, metadata: { action: d.action, outcome } }, tx);
    return { outcome };
  });
}

/** Re-try alerts that were waiting for an account (e.g. after the user added the account's last 4 digits). */
export async function retryPendingEmailCandidates(userId: string) {
  const pending = await prisma.emailTransactionCandidate.findMany({ where: { userId, status: "PENDING_REVIEW" }, include: candidateInclude, take: 500 });
  let placed = 0;
  for (const p of pending) {
    const r = await prisma.$transaction(async (tx) => {
      // Re-read under a row lock: the user may have approved/rejected it meanwhile.
      await tx.$queryRaw`SELECT id FROM "email_transaction_candidates" WHERE id = ${p.id} FOR UPDATE`;
      const c = await tx.emailTransactionCandidate.findFirst({ where: { id: p.id, userId, status: "PENDING_REVIEW" }, include: candidateInclude });
      return c ? ingestCandidate(tx, userId, c) : { outcome: "SKIPPED" as const, note: null };
    });
    if (r.outcome !== "NEEDS_ACCOUNT" && r.outcome !== "SKIPPED") placed++;
  }
  return { placed, remaining: await prisma.emailTransactionCandidate.count({ where: { userId, status: "PENDING_REVIEW" } }) };
}

// ───────────────────────────── queries ─────────────────────────────

export async function listEmailConnections(userId: string) {
  return prisma.emailConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, provider: true, emailAddress: true, status: true, lastSyncAt: true, lastError: true, createdAt: true,
      syncJobs: { orderBy: { startedAt: "desc" }, take: 1, select: { status: true, startedAt: true, finishedAt: true, messagesFetched: true, candidatesCreated: true, failedCount: true } },
      _count: { select: { messages: true } },
    },
  });
}

export type EmailConnectionItem = Awaited<ReturnType<typeof listEmailConnections>>[number];

export function emailProvidersStatus() {
  return { GMAIL: mailProvider("GMAIL").configured(), OUTLOOK: mailProvider("OUTLOOK").configured(), encryption: Boolean(process.env.TOKEN_ENCRYPTION_KEY) };
}

/** "Try the parser": shows what FinSight360 would read from an alert. Nothing is saved. */
export function previewAlert(input: unknown) {
  const d = parseOrThrow(emailParsePreviewSchema, input);
  const r = parseBankAlert({ from: d.from, subject: d.subject, text: d.text, receivedAt: new Date() });
  if (!r.ok) return { ok: false as const, reason: r.reason };
  const t = r.txn;
  return {
    ok: true as const,
    txn: { ...t, transactionDate: t.transactionDate.toISOString().slice(0, 10), transactionAt: t.transactionAt?.toISOString() ?? null },
  };
}
