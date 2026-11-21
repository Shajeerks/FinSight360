import "server-only";
import { BANK_SENDER_DOMAINS, senderBank } from "@/lib/email/parse";
import { emailAddressOf, gmailPayloadText, gmailStatementParts, headerValue, htmlToText } from "@/lib/email/text";
import { isStatementFile, STATEMENT_GMAIL_QUERY } from "@/lib/email/statements";
import { imapClient } from "@/lib/email/imap";

/**
 * Gmail (Gmail API) and Outlook (Microsoft Graph) mail access over plain HTTPS.
 * Read-only scopes only. Tokens are passed in decrypted for the duration of a
 * request and never logged. Tests swap the provider with `setMailProviderOverride`.
 */

export type MailProviderName = "GMAIL" | "OUTLOOK" | "IMAP";
export type RawMail = { id: string; threadId: string | null; from: string; subject: string; receivedAt: Date; text: string };
/** A statement file attached to an email (PDF / CSV / XLSX). `ref` is the provider's id for it. */
export type MailAttachment = { ref: string; fileName: string; mimeType: string | null; size: number | null };
export type StatementMail = { id: string; from: string; subject: string; receivedAt: Date; files: MailAttachment[] };
export type TokenSet = { accessToken: string; refreshToken?: string | null; expiresAt: Date; scope?: string | null };

export interface MailClient {
  /** Ids of messages from known bank senders received at/after `since` (newest first, at most `max`). */
  listBankMessageIds(since: Date, max: number): Promise<string[]>;
  getMessage(id: string): Promise<RawMail>;
  /** Ids of messages from known bank senders, at/after `since`, that carry a statement attachment. */
  listStatementMessageIds(since: Date, max: number): Promise<string[]>;
  /** Headers of a message plus its statement attachments (names only — nothing downloaded). */
  getStatementMail(id: string): Promise<StatementMail>;
  /** Downloads one attachment (looked up again by name: Gmail attachment ids change between fetches). */
  downloadAttachment(messageId: string, file: { ref: string; fileName: string }): Promise<Buffer>;
  /** Releases a held connection (IMAP). */
  close?(): Promise<void>;
}

export interface MailProvider {
  readonly name: MailProviderName;
  readonly scopes: string;
  configured(): boolean;
  authUrl(p: { state: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string;
  exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  profileEmail(accessToken: string): Promise<string>;
  revoke(token: string): Promise<void>;
  client(accessToken: string): MailClient;
}

/** The access token was rejected (expired/revoked) — the user must reconnect. */
export class MailAuthError extends Error {}
export class MailProviderError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit & { accessToken?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || /invalid_grant|insufficient|unauthor/i.test(body)) throw new MailAuthError(`Access was rejected (${res.status})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (/invalid_grant/.test(body)) throw new MailAuthError("Access was revoked or expired");
    throw new MailProviderError(`Mail provider error ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
const toTokenSet = (t: TokenResponse): TokenSet => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? null,
  expiresAt: new Date(Date.now() + Math.max(60, (t.expires_in ?? 3600) - 60) * 1000),
  scope: t.scope ?? null,
});
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

// ───────────────────────────── Gmail ─────────────────────────────

const gmail: MailProvider = {
  name: "GMAIL",
  scopes: "openid email https://www.googleapis.com/auth/gmail.readonly",
  configured: () => Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET),
  authUrl({ state, codeChallenge, redirectUri, loginHint }) {
    const q = new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: this.scopes,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    return toTokenSet(await call<TokenResponse>("https://oauth2.googleapis.com/token", form({ code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code", client_id: process.env.GMAIL_CLIENT_ID ?? "", client_secret: process.env.GMAIL_CLIENT_SECRET ?? "" })));
  },
  async refresh(refreshToken) {
    return toTokenSet(await call<TokenResponse>("https://oauth2.googleapis.com/token", form({ refresh_token: refreshToken, grant_type: "refresh_token", client_id: process.env.GMAIL_CLIENT_ID ?? "", client_secret: process.env.GMAIL_CLIENT_SECRET ?? "" })));
  },
  async profileEmail(accessToken) {
    const p = await call<{ emailAddress: string }>("https://gmail.googleapis.com/gmail/v1/users/me/profile", { accessToken });
    return p.emailAddress.toLowerCase();
  },
  async revoke(token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  },
  client(accessToken) {
    return {
      async listBankMessageIds(since, max) {
        const q = `from:(${BANK_SENDER_DOMAINS.join(" OR ")}) after:${Math.floor(since.getTime() / 1000)} -in:chats -in:spam -in:trash`;
        const ids: string[] = [];
        let pageToken: string | undefined;
        do {
          const params = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
          if (pageToken) params.set("pageToken", pageToken);
          const r = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { accessToken });
          ids.push(...(r.messages ?? []).map((m) => m.id));
          pageToken = r.nextPageToken;
        } while (pageToken && ids.length < max);
        return ids.slice(0, max);
      },
      async getMessage(id) {
        type Msg = { id: string; threadId?: string; internalDate?: string; payload?: Parameters<typeof gmailPayloadText>[0] & { headers?: { name: string; value: string }[] } };
        const m = await call<Msg>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { accessToken });
        return {
          id: m.id,
          threadId: m.threadId ?? null,
          from: headerValue(m.payload?.headers, "From"),
          subject: headerValue(m.payload?.headers, "Subject"),
          receivedAt: new Date(Number(m.internalDate ?? Date.now())),
          text: gmailPayloadText(m.payload).slice(0, 20_000),
        };
      },
      async listStatementMessageIds(since, max) {
        const q = `from:(${BANK_SENDER_DOMAINS.join(" OR ")}) has:attachment ${STATEMENT_GMAIL_QUERY} after:${Math.floor(since.getTime() / 1000)} -in:chats -in:spam -in:trash`;
        const r = await call<{ messages?: { id: string }[] }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(Math.min(100, max)) })}`, { accessToken });
        return (r.messages ?? []).map((m) => m.id).slice(0, max);
      },
      async getStatementMail(id) {
        type Msg = { id: string; internalDate?: string; payload?: Parameters<typeof gmailStatementParts>[0] & { headers?: { name: string; value: string }[] } };
        const m = await call<Msg>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { accessToken });
        return {
          id: m.id,
          from: headerValue(m.payload?.headers, "From"),
          subject: headerValue(m.payload?.headers, "Subject"),
          receivedAt: new Date(Number(m.internalDate ?? Date.now())),
          files: gmailStatementParts(m.payload).filter((f) => isStatementFile(f.fileName, f.mimeType)),
        };
      },
      async downloadAttachment(messageId, file) {
        type Msg = { payload?: Parameters<typeof gmailStatementParts>[0] };
        const m = await call<Msg>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, { accessToken });
        const ref = gmailStatementParts(m.payload).find((f) => f.fileName === file.fileName)?.ref ?? file.ref;
        const a = await call<{ data?: string }>(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(ref)}`, { accessToken });
        return Buffer.from((a.data ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
      },
    };
  },
};

// ───────────────────────────── Outlook (Microsoft Graph) ─────────────────────────────

const tenant = () => process.env.MICROSOFT_TENANT_ID || "common";

const outlook: MailProvider = {
  name: "OUTLOOK",
  scopes: "openid email offline_access User.Read Mail.Read",
  configured: () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
  authUrl({ state, codeChallenge, redirectUri, loginHint }) {
    const q = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: this.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
    return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${q}`;
  },
  async exchangeCode({ code, codeVerifier, redirectUri }) {
    return toTokenSet(await call<TokenResponse>(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, form({ code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code", client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", scope: this.scopes })));
  },
  async refresh(refreshToken) {
    return toTokenSet(await call<TokenResponse>(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, form({ refresh_token: refreshToken, grant_type: "refresh_token", client_id: process.env.MICROSOFT_CLIENT_ID ?? "", client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "", scope: this.scopes })));
  },
  async profileEmail(accessToken) {
    const me = await call<{ mail?: string | null; userPrincipalName?: string }>("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { accessToken });
    return (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
  },
  async revoke() {
    // Microsoft has no token-revocation endpoint for this flow; tokens are deleted locally
    // and the user can remove the app at https://account.live.com/consent/Manage.
  },
  client(accessToken) {
    return {
      async listBankMessageIds(since, max) {
        const ids: string[] = [];
        let url: string | undefined =
          `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${new URLSearchParams({ $filter: `receivedDateTime ge ${since.toISOString()}`, $orderby: "receivedDateTime desc", $select: "id,from", $top: "50" })}`;
        let scanned = 0;
        while (url && ids.length < max && scanned < 2000) {
          const r: { value: { id: string; from?: { emailAddress?: { address?: string } } }[]; "@odata.nextLink"?: string } = await call(url, { accessToken });
          for (const m of r.value) {
            scanned++;
            if (senderBank(m.from?.emailAddress?.address ?? "")) ids.push(m.id);
          }
          url = r["@odata.nextLink"];
        }
        return ids.slice(0, max);
      },
      async getMessage(id) {
        type Msg = { id: string; conversationId?: string; subject?: string; receivedDateTime: string; from?: { emailAddress?: { name?: string; address?: string } }; body?: { contentType: string; content: string } };
        const m = await call<Msg>(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,conversationId,subject,receivedDateTime,from,body`, { accessToken });
        const body = m.body?.content ?? "";
        return {
          id: m.id,
          threadId: m.conversationId ?? null,
          from: emailAddressOf(m.from?.emailAddress?.address ?? ""),
          subject: m.subject ?? "",
          receivedAt: new Date(m.receivedDateTime),
          text: (m.body?.contentType === "html" ? htmlToText(body) : body).slice(0, 20_000),
        };
      },
      async listStatementMessageIds(since, max) {
        const ids: string[] = [];
        let url: string | undefined =
          `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${new URLSearchParams({ $filter: `receivedDateTime ge ${since.toISOString()} and hasAttachments eq true`, $orderby: "receivedDateTime desc", $select: "id,from", $top: "50" })}`;
        let scanned = 0;
        while (url && ids.length < max && scanned < 1000) {
          const r: { value: { id: string; from?: { emailAddress?: { address?: string } } }[]; "@odata.nextLink"?: string } = await call(url, { accessToken });
          for (const m of r.value) {
            scanned++;
            if (senderBank(m.from?.emailAddress?.address ?? "")) ids.push(m.id);
          }
          url = r["@odata.nextLink"];
        }
        return ids.slice(0, max);
      },
      async getStatementMail(id) {
        type Msg = { id: string; subject?: string; receivedDateTime: string; from?: { emailAddress?: { address?: string } } };
        const m = await call<Msg>(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,subject,receivedDateTime,from`, { accessToken });
        const a = await call<{ value: { id: string; name?: string; contentType?: string; size?: number }[] }>(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size`, { accessToken });
        return {
          id: m.id,
          from: emailAddressOf(m.from?.emailAddress?.address ?? ""),
          subject: m.subject ?? "",
          receivedAt: new Date(m.receivedDateTime),
          files: a.value
            .map((x) => ({ ref: x.id, fileName: x.name ?? "statement", mimeType: x.contentType ?? null, size: x.size ?? null }))
            .filter((f) => isStatementFile(f.fileName, f.mimeType)),
        };
      },
      async downloadAttachment(messageId, file) {
        const a = await call<{ contentBytes?: string }>(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(file.ref)}`, { accessToken });
        return Buffer.from(a.contentBytes ?? "", "base64");
      },
    };
  },
};

// ───────────────────────────── IMAP (app password: Gmail, Yahoo, …) ─────────────────────────────

/**
 * IMAP mailboxes connect with an app password instead of OAuth. The "access token"
 * handed to `client()` is the decrypted JSON {host, user, pass}; there is nothing to
 * refresh or revoke (the user deletes the app password at their provider).
 */
const imap: MailProvider = {
  name: "IMAP",
  scopes: "imap:read",
  configured: () => true,
  authUrl() {
    throw new MailProviderError("IMAP mailboxes connect with an app password", 400);
  },
  async exchangeCode() {
    throw new MailProviderError("IMAP mailboxes connect with an app password", 400);
  },
  async refresh() {
    throw new MailAuthError("IMAP passwords don't expire — enter the app password again");
  },
  async profileEmail(secret) {
    return (JSON.parse(secret) as { user: string }).user.toLowerCase();
  },
  async revoke() {
    // Nothing to revoke: the stored app password is deleted; the user can also delete it at the provider.
  },
  client(secret) {
    return imapClient(JSON.parse(secret) as { host: string; user: string; pass: string });
  },
};

const overrides = new Map<MailProviderName, MailProvider>();

/** Test hook: replace a provider with a fake. */
export function setMailProviderOverride(name: MailProviderName, provider: MailProvider | null) {
  if (provider) overrides.set(name, provider);
  else overrides.delete(name);
}

export function mailProvider(name: MailProviderName): MailProvider {
  return overrides.get(name) ?? (name === "GMAIL" ? gmail : name === "IMAP" ? imap : outlook);
}
