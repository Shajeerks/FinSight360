import { parseAmount, parseDateWith, type DateFormat } from "@/lib/import/values";
import { classifyImported } from "@/lib/import/classify";
import { extractMerchant, normalizeDescription } from "@/lib/transactions/normalize";

/**
 * Bank / card transaction-alert parser for Indian banks (pure, unit-tested).
 *
 * It only extracts what the alert states — it never guesses an amount. Mails
 * that are not completed transactions (OTPs, offers, statements, declined or
 * failed attempts, payment reminders) are rejected as NOT_FINANCIAL.
 */

export type EmailInput = { from: string; subject: string; text: string; receivedAt: Date };

export type ParsedEmailTxn = {
  parserId: string;
  bank: string | null;
  amount: string;
  direction: "DEBIT" | "CREDIT";
  transactionType: "EXPENSE" | "INCOME" | "REFUND" | "REVERSAL" | "INTEREST" | "FEE" | "ATM_WITHDRAWAL" | "EMI" | "INVESTMENT" | "CARD_PAYMENT" | "TRANSFER";
  /** Which instrument the money moved on. "debit-card" = a bank account we can't identify from the card digits. */
  instrument: "bank" | "card" | "debit-card" | "unknown";
  accountLast4: string | null;
  cardLast4: string | null;
  merchantName: string | null;
  referenceNumber: string | null;
  transactionDate: Date;
  transactionAt: Date | null;
  description: string;
  confidence: number;
};

export type ParseResult = { ok: true; txn: ParsedEmailTxn } | { ok: false; reason: string };

/** Exact domains (or their subdomains — "alerts.sbi.co.in") — never look-alikes such as "notsc.com". */
const SENDERS: [string[], string, string][] = [
  [["hdfcbank.net", "hdfcbank.com", "hdfcbank.bank.in"], "HDFC Bank", "hdfc"],
  [["icicibank.com"], "ICICI Bank", "icici"],
  [["sbi.co.in", "sbicard.com"], "State Bank of India", "sbi"],
  [["axisbank.com", "axisbank.in"], "Axis Bank", "axis"],
  [["kotak.com", "kotak.bank.in"], "Kotak Mahindra Bank", "kotak"],
  [["yesbank.in"], "Yes Bank", "yes"],
  [["idfcfirstbank.com"], "IDFC FIRST Bank", "idfc"],
  [["indusind.com"], "IndusInd Bank", "indusind"],
  [["aubank.in"], "AU Small Finance Bank", "au"],
  [["federalbank.co.in"], "Federal Bank", "federal"],
  [["rblbank.com"], "RBL Bank", "rbl"],
  [["pnb.co.in", "pnb.bank.in"], "Punjab National Bank", "pnb"],
  [["bankofbaroda.com", "bankofbaroda.co.in", "bobfinancial.com"], "Bank of Baroda", "bob"],
  [["canarabank.com", "canarabank.in"], "Canara Bank", "canara"],
  [["unionbankofindia.com", "unionbankofindia.co.in"], "Union Bank of India", "union"],
  [["sc.com"], "Standard Chartered", "sc"],
  [["hsbc.co.in"], "HSBC", "hsbc"],
  [["citi.com", "citibank.com"], "Citibank", "citi"],
  [["americanexpress.com", "americanexpress.co.in", "aexp.com"], "American Express", "amex"],
  [["onecard.app", "getonecard.app"], "OneCard", "onecard"],
];

/** Sender domains used to build the mailbox search (Gmail `from:` query). */
export const BANK_SENDER_DOMAINS = [
  "hdfcbank.net", "hdfcbank.com", "icicibank.com", "sbi.co.in", "sbicard.com", "axisbank.com", "kotak.com", "yesbank.in",
  "idfcfirstbank.com", "indusind.com", "aubank.in", "federalbank.co.in", "rblbank.com", "pnb.co.in", "bankofbaroda.com",
  "canarabank.com", "unionbankofindia.co.in", "sc.com", "hsbc.co.in", "citi.com", "americanexpress.com", "getonecard.app",
];

export function senderBank(from: string): { bank: string; id: string } | null {
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const domain = addr.split("@")[1] ?? "";
  for (const [domains, bank, id] of SENDERS) if (domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return { bank, id };
  return null;
}

const NOT_TXN: [RegExp, string][] = [
  [/\b(OTP|one[\s-]?time[\s-]?password|verification code)\b/i, "One-time password"],
  [/\b(declined|was not successful|unsuccessful|has failed|could not be processed|failed due to|insufficient (funds|balance))\b/i, "Declined or failed transaction"],
  [/\b(statement (is|for)|e-?statement|statement of account|statement generated)\b/i, "Statement notification"],
  [/\b(payment (is )?due|due date|minimum amount due|total amount due|reminder)\b/i, "Payment reminder"],
  [/\b(pre-?approved|offer|eligible for|apply now|limited period|congratulations|upgrade)\b/i, "Promotion"],
  [/\b(will be debited|is scheduled|mandate (has been )?(registered|created)|standing instruction (registered|created))\b/i, "Not a completed transaction"],
];

const DEBIT_VERBS = /\b(debited|spent|for using|withdrawn|sent|paid|transferred|deducted|used for (a )?(purchase|transaction)|charged|purchase of|txn of)\b/i;
const CREDIT_VERBS = /\b(credited|received|deposited|refunded|reversed|added to)\b/i;
const AMOUNT_RE = /(?:INR|Rs\.?|₹)\s?([\d,]+(?:\.\d{1,2})?)(?![\d,])/gi;
/** "debited by 150.0" — SBI style, no currency marker. */
const BARE_AMOUNT_RE = /\b(?:debited|credited)\s+(?:by|for|with)\s+([\d,]+(?:\.\d{1,2})?)(?![\d,])/i;
const BALANCE_WORDS = /\b(avl|avail|available|bal|balance|limit|outstanding|reward points?)\b/i;

/** Start of the clause that contains `index` (sentence end, ";" or line break). */
function clauseStart(text: string, index: number) {
  const before = text.slice(0, index);
  const m = [...before.matchAll(/(?:[.!?](?=\s)|[;\n])/g)].pop();
  return m ? (m.index ?? 0) + 1 : 0;
}

/**
 * The transaction amount — never a balance or limit figure. Amounts whose clause
 * mentions a balance/limit are skipped; an amount in a clause with a debit/credit
 * verb wins over one without.
 */
function findAmount(text: string): { amount: string; index: number } | null {
  const candidates: { amount: string; index: number; withVerb: boolean }[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const idx = m.index ?? 0;
    const start = clauseStart(text, idx);
    const before = text.slice(start, idx);
    const after = text.slice(idx + m[0].length, idx + m[0].length + 24);
    if (BALANCE_WORDS.test(before) || /^\s*(is\s+)?(your\s+)?(avl|available|bal|balance|limit)\b/i.test(after)) continue;
    const a = parseAmount(m[1]);
    if (!a || a.amount.startsWith("-") || /^0+\.00$/.test(a.amount)) continue;
    const endM = text.slice(idx).search(/[.!?](?=\s)|[;\n]/);
    const clause = text.slice(start, endM < 0 ? undefined : idx + endM);
    candidates.push({ amount: a.amount, index: idx, withVerb: DEBIT_VERBS.test(clause) || CREDIT_VERBS.test(clause) });
  }
  const best = candidates.find((c) => c.withVerb) ?? candidates[0];
  if (best) return { amount: best.amount, index: best.index };
  const bare = BARE_AMOUNT_RE.exec(text);
  const a = bare ? parseAmount(bare[1]) : null;
  return a && !/^0+\.00$/.test(a.amount) ? { amount: a.amount, index: bare!.index } : null;
}

const ACCOUNT_RE = /\b(?:a\/c|acct|account|ac)\b\.?\s*(?:no\.?|number|num)?\s*(?:ending(?:\s+(?:with|in))?\s*)?[:\-]?\s*(?:[x*]+\s*)?(\d{3,4})\b/i;
const CARD_RE = /\bcard\b\s*(?:no\.?|number|num)?\s*(?:ending(?:\s+(?:with|in))?\s*)?[:\-]?\s*(?:[x*]+\s*)?(\d{4})\b/i;
const REF_KEY = /\b(?:UPI|Ref(?:erence)?|UTR|RRN|Txn|Transaction ID)\b/gi;

/** First id-like token (has a digit, 6–22 chars) shortly after a reference keyword. */
function findReference(text: string): string | null {
  for (const k of text.matchAll(REF_KEY)) {
    const after = text.slice((k.index ?? 0) + k[0].length, (k.index ?? 0) + k[0].length + 45);
    const m = after.match(/(?:^|[\s:#/\-])(?=[A-Za-z0-9]*\d)([A-Za-z0-9]{6,22})\b/);
    if (m && !/^\d{1,2}[A-Za-z]{3}\d{2,4}$/.test(m[1])) return m[1];
  }
  return null;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_CANDIDATES: [RegExp, (m: RegExpMatchArray) => [string, DateFormat][]][] = [
  [/\b(\d{4}-\d{2}-\d{2})\b/, (m) => [[m[1], "yyyy-MM-dd"]]],
  [/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/, (m) => [[m[1].replace(/[-.]/g, "/"), "dd/MM/yyyy"]]],
  [/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2})\b/, (m) => [[m[1].replace(/[-.]/g, "/"), "dd/MM/yy"]]],
  [new RegExp(`\\b(\\d{1,2})[- ]?(${MONTHS})[a-z]*[- ,]*(\\d{4}|\\d{2})\\b`, "i"), (m) => [[`${m[1]} ${m[2]} ${m[3]}`, m[3].length === 4 ? "dd MMM yyyy" : "dd MMM yy"]]],
  // "Oct 03, 2026" (ICICI)
  [new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"), (m) => [[`${m[2]} ${m[1]} ${m[3]}`, "dd MMM yyyy"]]],
];

function istParts(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60_000);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate() };
}

function findDate(text: string, receivedAt: Date): { date: Date; at: Date | null; explicit: boolean } {
  const r = istParts(receivedAt);
  const fallback = { date: new Date(Date.UTC(r.y, r.m, r.d)), at: receivedAt, explicit: false };
  for (const [re, conv] of DATE_CANDIDATES) {
    const m = text.match(re);
    if (!m) continue;
    for (const [value, fmt] of conv(m)) {
      const date = parseDateWith(value, fmt);
      if (!date) continue;
      // Sanity: an alert describes something that just happened.
      const diffDays = (fallback.date.getTime() - date.getTime()) / 86_400_000;
      if (diffDays < -1 || diffDays > 15) continue;
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16);
      const t = after.match(/^\s*(?:at\s*|[:,]\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?m?\.?(?![a-z])/i);
      let hour = t ? +t[1] : 0;
      if (t?.[4]) {
        const pm = t[4].toLowerCase() === "p";
        if (pm && hour < 12) hour += 12;
        if (!pm && hour === 12) hour = 0;
      }
      const at = t && hour < 24 ? new Date(date.getTime() + ((hour * 60 + +t[2]) * 60 + (+(t[3] ?? 0))) * 1000 - 330 * 60_000) : null;
      return { date, at, explicit: true };
    }
  }
  return fallback;
}

function cleanMerchant(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let m = raw.trim().replace(/^(VPA|M\/S|MS\.?)\s+/i, "").replace(/[.,;:\-\s]+$/, "");
  if (/@/.test(m) && !/\s/.test(m)) m = m.split("@")[0].replace(/[._\-\d]+/g, " ");
  m = m.replace(/\s{2,}/g, " ").trim();
  if (m.length < 2 || /^(your|the|a|an|account|card|bank|you)$/i.test(m)) return null;
  return m.slice(0, 60).toUpperCase();
}

function findMerchant(text: string, direction: "DEBIT" | "CREDIT"): string | null {
  const stop = String.raw`(?=\s+on\s+\d|\s+on\s+(?:${MONTHS})|\s+on\s+\d{2}[a-z]{3}|\s*\(|\.\s|\.$|,|;|\s+Avl|\s+Available|\s+Ref|\s+UPI|\s+if\b|$)`;
  const patterns: RegExp[] = [
    new RegExp(String.raw`\bVPA\s+[\w.\-]+@[\w.\-]+\s+([A-Za-z][A-Za-z0-9 &.'\-]{2,40}?)${stop}`, "i"),
    new RegExp(String.raw`\bVPA\s+([\w.\-]+@[\w.\-]+)`, "i"),
    new RegExp(String.raw`\bat\s+([A-Za-z0-9][A-Za-z0-9 &.'*\-/]{1,40}?)${stop}`, "i"),
    new RegExp(String.raw`;\s*([A-Za-z0-9][A-Za-z0-9 &.\-]{2,40}?)\s+credited`, "i"),
    new RegExp(String.raw`\btowards\s+(?:refund\s+)?from\s+([A-Za-z0-9][A-Za-z0-9 &.\-]{2,40}?)${stop}`, "i"),
    new RegExp(String.raw`\brefund\s+from\s+([A-Za-z0-9][A-Za-z0-9 &.\-]{2,40}?)${stop}`, "i"),
    ...(direction === "CREDIT"
      ? [new RegExp(String.raw`\bfrom\s+(?!your\b|a\/c|account)([A-Za-z][A-Za-z0-9 &.\-]{2,40}?)${stop}`, "i"), new RegExp(String.raw`\bby\s+(?!NEFT\b|IMPS\b|RTGS\b|UPI\b|transfer\b)([A-Za-z][A-Za-z0-9 &.\-]{2,40}?)${stop}`, "i")]
      : [new RegExp(String.raw`\b(?:to|transfer to)\s+(?!your\b|a\/c|account|HDFC Bank Credit)([A-Za-z0-9][A-Za-z0-9 &.@\-]{2,40}?)${stop}`, "i")]),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const name = cleanMerchant(m?.[1]);
    if (name && !/^(NEFT|IMPS|RTGS|UPI|ATM|BANK|CARD)$/i.test(name)) return name;
  }
  const info = text.match(/\bInfo[-:\s]+([^\n.]{3,80})/i)?.[1];
  return info ? extractMerchant(info) : null;
}

export function parseBankAlert(input: EmailInput): ParseResult {
  const sender = senderBank(input.from);
  const text = `${input.subject}\n${input.text}`.replace(/ /g, " ").replace(/[ \t]+/g, " ");
  // Only the top of the mail decides this — genuine alerts often carry offers in their footer.
  const head = text.slice(0, 600);
  for (const [re, reason] of NOT_TXN) if (re.test(head)) return { ok: false, reason };

  const amount = findAmount(text);
  if (!amount) return { ok: false, reason: "No transaction amount" };

  const d = DEBIT_VERBS.exec(text);
  const c = CREDIT_VERBS.exec(text);
  const cardSpendWithoutVerb = !d && !c && /\b(transaction|txn) amount\b/i.test(text) && CARD_RE.test(text);
  if (!d && !c && !cardSpendWithoutVerb) return { ok: false, reason: "No debit/credit wording" };
  // The first verb describes the account/card in the alert ("A/c debited …; SWIGGY credited").
  let direction: "DEBIT" | "CREDIT" = cardSpendWithoutVerb || !c || (d && d.index < c.index) ? "DEBIT" : "CREDIT";
  const explicitDebit = /\b(debited|deducted|withdrawn)\s+from\b|\bhas been debited\b/i.test(text);
  const explicitCredit = /\bcredited\s+(to|in(to)?)\s+(your\s+)?(a\/c|acct|account|ac|card|credit card)\b/i.test(text);
  if (explicitDebit && !explicitCredit) direction = "DEBIT";
  else if (explicitCredit && !explicitDebit) direction = "CREDIT";
  // "Payment … received towards your credit card" → card credit (but never when the mail says it was debited).
  else if (!explicitDebit && /\bpayment\b[^.]{0,60}\breceived\b/i.test(text)) direction = "CREDIT";

  // The money account — not a loan account mentioned in the same alert ("EMI for loan a/c 7654 debited from a/c XX4321").
  const acct =
    [...text.matchAll(new RegExp(ACCOUNT_RE.source, "gi"))].find((m) => !/\bloan\s*$/i.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index)))?.[1] ?? null;
  const cardDigits = text.match(CARD_RE)?.[1] ?? null;
  const isDebitCard = /\bdebit card\b/i.test(text);
  let instrument: ParsedEmailTxn["instrument"] = "unknown";
  if (acct) instrument = "bank";
  else if (cardDigits) instrument = isDebitCard ? "debit-card" : "card";

  const sentence =
    text
      .split(/(?<=[.!])\s+|\n/)
      .find((s) => /(INR|Rs\.?|₹)\s?[\d,]/i.test(s) && (DEBIT_VERBS.test(s) || CREDIT_VERBS.test(s)))
      ?.trim() ?? input.subject;
  const merchantName = findMerchant(text, direction);
  const kind = instrument === "card" ? "card" : "bank";
  let transactionType = classifyImported(direction, kind, `${sentence} ${merchantName ?? ""}`);
  if (instrument === "bank" && cardDigits && direction === "DEBIT" && /credit card/i.test(text) && /\b(towards|payment|paid to)\b/i.test(text)) transactionType = "CARD_PAYMENT";
  if (/\bATM\b|cash withdrawal|withdrawn at/i.test(text) && direction === "DEBIT") transactionType = "ATM_WITHDRAWAL";

  const ref = findReference(text);
  const when = findDate(text, input.receivedAt);

  let confidence = 50 + 20; // amount found
  confidence += cardSpendWithoutVerb ? 0 : 10; // explicit debit/credit wording
  if (instrument !== "unknown") confidence += 10;
  if (when.explicit) confidence += 5;
  if (ref) confidence += 3;
  if (merchantName) confidence += 5;
  if (sender) confidence += 5;
  if (acct && acct.length < 4) confidence -= 5;
  confidence = Math.min(sender ? 98 : 75, confidence);

  const description = (merchantName ? `${merchantName} — ` : "") + normalizeDescription(sentence).slice(0, 200);
  return {
    ok: true,
    txn: {
      parserId: `${sender?.id ?? "generic"}-v1`,
      bank: sender?.bank ?? null,
      amount: amount.amount,
      direction,
      transactionType,
      instrument,
      accountLast4: acct,
      cardLast4: cardDigits,
      merchantName,
      referenceNumber: ref ? ref.toUpperCase() : null,
      transactionDate: when.date,
      transactionAt: when.at,
      description: description.slice(0, 300),
      confidence,
    },
  };
}
