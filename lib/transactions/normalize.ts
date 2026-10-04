/**
 * Transaction text normalization.
 *
 * Bank/email/statement descriptions are noisy ("UPI/412345678901/SWIGGY/swiggy@icici/Payment").
 * We derive:
 *  • normalizedDescription — upper-case, punctuation-free, without long reference
 *    numbers or UPI handles, used for matching and duplicate detection;
 *  • a best-effort merchant name.
 */

/** Upper-case, keep A–Z/0–9, single spaces. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip reference numbers, UPI handles and card masks before normalizing. */
export function normalizeDescription(description: string | null | undefined): string {
  const cleaned = (description ?? "")
    .replace(/[a-z0-9._-]+@[a-z0-9.-]+/gi, " ") // UPI VPA / email handles
    .replace(/X{2,}\d{2,4}/gi, " ") // masked card/account numbers (XXXX1234)
    .replace(/\*{2,}\d{2,4}/g, " ")
    .replace(/\b\d{6,}\b/g, " "); // long reference numbers
  return normalizeText(cleaned);
}

/** Merchant key used for unique lookup and rule matching. */
export function merchantKey(name: string | null | undefined): string {
  return normalizeText(name)
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|INDIA|IN|COM|WWW)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NOISE = new Set([
  "UPI", "POS", "NEFT", "IMPS", "RTGS", "ECOM", "ACH", "NACH", "BIL", "BILLPAY", "MMT", "INB", "DEBIT", "CREDIT",
  "DR", "CR", "TXN", "TRANSACTION", "PURCHASE", "PAYMENT", "PAID", "TO", "FROM", "REF", "NO", "ORDER", "VIA", "AT",
  "ON", "THE", "CARD", "TRANSFER", "SENT", "RECEIVED", "P2M", "P2A", "COLLECT", "REQUEST",
]);

/**
 * Best-effort merchant name from a raw description, e.g.
 *   "UPI/412345678901/SWIGGY/swiggy@icici/Payment" → "SWIGGY"
 *   "POS 4512XXXX1234 AMAZON PAY INDIA BANGALORE"  → "AMAZON PAY"
 * Returns null when nothing meaningful remains.
 */
export function extractMerchant(description: string | null | undefined): string | null {
  const raw = description ?? "";
  // Slash/dash separated UPI style: pick the first segment that has letters and isn't noise.
  if (/^(UPI|IMPS|NEFT)[/-]/i.test(raw)) {
    for (const seg of raw.split(/[/-]/).slice(1)) {
      const n = normalizeDescription(seg);
      if (n && /[A-Z]{3,}/.test(n) && !NOISE.has(n)) return n.split(" ").slice(0, 3).join(" ");
    }
  }
  const words = normalizeDescription(raw)
    .split(" ")
    .filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w));
  if (!words.length) return null;
  return words.slice(0, 2).join(" ");
}

/** Whole-word containment on normalized text ("UBER" matches "UBER TRIP", not "UBERTY"). */
export function containsWord(haystack: string, needle: string): boolean {
  const h = ` ${normalizeText(haystack)} `;
  const n = normalizeText(needle);
  return n.length > 0 && h.includes(` ${n} `);
}
