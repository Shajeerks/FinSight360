/**
 * Statement attachments in bank / card emails (pure helpers, unit-tested).
 * Only PDF, CSV and XLSX files are picked up — the formats the statement importer reads.
 */

const EXT = /\.(pdf|csv|xlsx)$/i;
const MIME = /^(application\/pdf|text\/csv|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/i;

/** Gmail search fragment for messages with statement attachments. */
export const STATEMENT_GMAIL_QUERY = "(filename:pdf OR filename:csv OR filename:xlsx)";

export function isStatementFile(fileName: string, mimeType: string | null | undefined): boolean {
  if (EXT.test(fileName)) return true;
  return Boolean(mimeType && MIME.test(mimeType) && !/\.(xls|zip|html?|jpe?g|png|gif)$/i.test(fileName));
}

export type AccountHint = { ref: string; kind: "bank" | "card"; bankName: string; last4: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const CARD_WORDS = /\b(credit\s*card|card\s*statement|card\s*account|cc\s*statement)\b/i;
const BANK_WORDS = /\b(account\s*statement|savings|current\s*account|e-?statement\s*for\s*(a\/?c|account)|statement\s*of\s*account|bank\s*statement)\b/i;

/**
 * Works out which of your accounts a statement email is for:
 *  1. the last 4 digits of exactly one account / card appear in the subject or file name;
 *  2. otherwise, the sending bank has exactly one account of the right kind (card vs bank).
 * Returns null when it isn't certain — you then choose the account yourself.
 */
export function suggestStatementAccount(
  email: { subject: string; fileName: string; bank: string | null },
  accounts: AccountHint[],
): string | null {
  const text = `${email.subject} ${email.fileName}`;
  const byDigits = accounts.filter((a) => a.last4 && new RegExp(`(^|\\D)${a.last4}(\\D|$)`).test(text));
  if (byDigits.length === 1) return byDigits[0].ref;
  if (!email.bank) return null;
  const sameBank = accounts.filter((a) => norm(a.bankName).includes(norm(email.bank!).replace(/bank$/, "")) || norm(email.bank!).includes(norm(a.bankName).replace(/bank$/, "")));
  const kind = CARD_WORDS.test(text) ? "card" : BANK_WORDS.test(text) ? "bank" : null;
  const candidates = kind ? sameBank.filter((a) => a.kind === kind) : sameBank;
  return candidates.length === 1 ? candidates[0].ref : null;
}

/** Mail server for an address, so you only type your email and app password. */
export function imapHostFor(email: string): string | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return "imap.gmail.com";
  if (/^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/.test(domain)) return "imap.mail.yahoo.com";
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return "outlook.office365.com";
  if (/^rediffmail\.com$/.test(domain)) return "imap.rediffmail.com";
  if (/^zoho(mail)?\.(com|in)$/.test(domain)) return "imap.zoho.in";
  if (/^icloud\.com$|^me\.com$/.test(domain)) return "imap.mail.me.com";
  return null;
}

/** Friendly name for an IMAP mailbox in the list. */
export function imapLabel(host: string | null): string {
  if (!host) return "Email (app password)";
  if (host.includes("gmail")) return "Gmail";
  if (host.includes("yahoo")) return "Yahoo Mail";
  if (host.includes("office365") || host.includes("outlook")) return "Outlook";
  if (host.includes("rediff")) return "Rediffmail";
  if (host.includes("zoho")) return "Zoho Mail";
  if (host.includes("me.com")) return "iCloud Mail";
  return host;
}
