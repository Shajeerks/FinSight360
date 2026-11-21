import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { BANK_SENDER_DOMAINS } from "@/lib/email/parse";
import { htmlToText } from "@/lib/email/text";
import { isStatementFile } from "@/lib/email/statements";
import { MailAuthError, MailProviderError, type MailClient, type RawMail, type StatementMail } from "@/lib/email/providers";

/**
 * IMAP access with an app password (Gmail, Yahoo, …). Read-only: the INBOX is opened
 * read-only, so nothing is marked as read or moved. One connection is held per sync
 * and closed by `close()`.
 */
export type ImapSecret = { host: string; user: string; pass: string; /** tests only */ port?: number; secure?: boolean };

function newFlow(s: ImapSecret) {
  return new ImapFlow({ host: s.host, port: s.port ?? 993, secure: s.secure ?? true, auth: { user: s.user, pass: s.pass }, logger: false, socketTimeout: 60_000, connectionTimeout: 20_000 });
}

function wrap(e: unknown): never {
  const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  if (err?.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(err?.responseText ?? err?.message ?? "")) {
    throw new MailAuthError("The mail server rejected the email / app password");
  }
  throw new MailProviderError(`Mail server error${err?.code ? ` (${err.code})` : ""}`, 502);
}

/** Logs in once to check the address and app password. */
export async function verifyImap(s: ImapSecret): Promise<void> {
  const c = newFlow(s);
  try {
    await c.connect();
    await c.logout();
  } catch (e) {
    c.close();
    wrap(e);
  }
}

const fromOf = (p: ParsedMail) => {
  const v = p.from?.value?.[0];
  return v ? (v.name ? `${v.name} <${v.address ?? ""}>` : (v.address ?? "")) : "";
};

export function imapClient(s: ImapSecret): MailClient {
  let flow: ImapFlow | null = null;
  let release: (() => void) | null = null;
  const parsed = new Map<string, ParsedMail>();

  async function open() {
    if (flow) return flow;
    const c = newFlow(s);
    try {
      await c.connect();
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      release = () => lock.release();
    } catch (e) {
      c.close();
      wrap(e);
    }
    flow = c;
    return c;
  }

  async function search(since: Date): Promise<number[]> {
    const c = await open();
    const or = BANK_SENDER_DOMAINS.map((d) => ({ from: d }));
    const uids = await c.search({ since, or }, { uid: true }).catch(wrap);
    return (uids || []).sort((a, b) => b - a);
  }

  async function load(id: string): Promise<ParsedMail> {
    const hit = parsed.get(id);
    if (hit) return hit;
    const c = await open();
    const m = await c.fetchOne(id, { source: true }, { uid: true }).catch(wrap);
    if (!m || !m.source) throw new MailProviderError("Message not found", 404);
    const p = await simpleParser(m.source);
    if (parsed.size > 20) parsed.clear();
    parsed.set(id, p);
    return p;
  }

  return {
    async listBankMessageIds(since, max) {
      return (await search(since)).slice(0, max).map(String);
    },
    async getMessage(id): Promise<RawMail> {
      const p = await load(id);
      const text = (p.text && p.text.trim().length > 20 ? p.text : htmlToText(typeof p.html === "string" ? p.html : "")).replace(/\r/g, "");
      return { id, threadId: null, from: fromOf(p), subject: p.subject ?? "", receivedAt: p.date ?? new Date(), text: text.slice(0, 20_000) };
    },
    async listStatementMessageIds(since, max) {
      const c = await open();
      const uids = await search(since);
      if (!uids.length) return [];
      const out: string[] = [];
      // Only the structure is fetched here (no bodies) to find messages with statement files.
      for await (const m of c.fetch(uids.slice(0, 300).join(","), { uid: true, bodyStructure: true }, { uid: true })) {
        const names: { name: string; type: string }[] = [];
        const walk = (n: { type?: string; dispositionParameters?: { filename?: string }; parameters?: { name?: string }; childNodes?: unknown[] } | undefined) => {
          if (!n) return;
          const name = n.dispositionParameters?.filename ?? n.parameters?.name;
          if (name) names.push({ name, type: n.type ?? "" });
          (n.childNodes as typeof n[] | undefined)?.forEach(walk);
        };
        walk(m.bodyStructure as never);
        if (names.some((x) => isStatementFile(x.name, x.type))) out.push(String(m.uid));
      }
      return out.sort((a, b) => Number(b) - Number(a)).slice(0, max);
    },
    async getStatementMail(id): Promise<StatementMail> {
      const p = await load(id);
      return {
        id,
        from: fromOf(p),
        subject: p.subject ?? "",
        receivedAt: p.date ?? new Date(),
        files: p.attachments
          .map((a, i) => ({ ref: String(i), fileName: a.filename ?? `statement-${i + 1}`, mimeType: a.contentType ?? null, size: a.size ?? null }))
          .filter((f) => isStatementFile(f.fileName, f.mimeType)),
      };
    },
    async downloadAttachment(messageId, file) {
      const p = await load(messageId);
      const a = p.attachments.find((x) => x.filename === file.fileName) ?? p.attachments[Number(file.ref)];
      if (!a) throw new MailProviderError("Attachment not found", 404);
      return a.content;
    },
    async close() {
      try {
        release?.();
        await flow?.logout();
      } catch {
        flow?.close();
      }
      flow = null;
      release = null;
      parsed.clear();
    },
  };
}
