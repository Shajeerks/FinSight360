/**
 * Turning provider message payloads into plain text (pure, unit-tested).
 * Bodies are only held in memory while parsing — they are never stored.
 */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: "-", mdash: "-", rupee: "₹", "#8377": "₹", "#x20b9": "₹" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
    return m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function b64urlDecode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

type GmailPart = { mimeType?: string; body?: { data?: string; size?: number }; parts?: GmailPart[]; filename?: string };

/** Gmail `format=full` payload → plain text (text/plain preferred, else HTML converted). */
export function gmailPayloadText(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: GmailPart) => {
    if (p.filename) return; // attachments are ignored
    if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(b64urlDecode(p.body.data));
      else if (p.mimeType === "text/html") html.push(b64urlDecode(p.body.data));
    }
    p.parts?.forEach(walk);
  };
  walk(payload);
  const text = plain.join("\n").trim();
  if (text.length > 20) return text.replace(/\r/g, "");
  return htmlToText(html.join("\n"));
}

export function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** "HDFC Bank InstaAlerts <alerts@hdfcbank.net>" → "alerts@hdfcbank.net" */
export function emailAddressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}
