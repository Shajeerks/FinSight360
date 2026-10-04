import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Inbox, Lock, Mail, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { emailProvidersStatus, listEmailCandidates, listEmailConnections, PROVIDER_LABEL } from "@/services/email.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DisconnectButton, ParserPlayground, SyncNowButton, UnplacedAlerts, type CandidateView } from "@/features/email/email-components";

export const metadata: Metadata = { title: "Email Sync" };

const ERRORS: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: "That provider isn't set up on this FinSight360 instance yet — see the setup steps below.",
  ENCRYPTION_NOT_CONFIGURED: "TOKEN_ENCRYPTION_KEY is missing from .env. Run npm run setup:env (or add it) and restart.",
  OAUTH_DENIED: "Access wasn't granted, so nothing was connected.",
  OAUTH_STATE: "The connection link expired or didn't match. Please start again.",
  OAUTH_PROFILE: "Couldn't read the mailbox address. Please try again.",
};

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  ACTIVE: { label: "Connected", variant: "success" },
  ERROR: { label: "Last sync failed", variant: "warning" },
  EXPIRED: { label: "Reconnect needed", variant: "destructive" },
  DISCONNECTED: { label: "Disconnected", variant: "secondary" },
};

export default async function EmailSyncPage(props: PageProps<"/imports/email">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const [connections, candidates, options] = await Promise.all([listEmailConnections(user.id), listEmailCandidates(user.id), getTransactionFormOptions(user.id)]);
  const providers = emailProvidersStatus();
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Something went wrong while connecting. Please try again.") : null;
  const connected = typeof sp.connected === "string" ? connections.find((c) => c.id === sp.connected) : null;
  const items: CandidateView[] = candidates.map((c) => ({
    id: c.id,
    date: c.transactionDate.toISOString().slice(0, 10),
    amount: c.amount.toFixed(2),
    direction: c.direction,
    description: c.description ?? "",
    merchant: c.merchantName,
    note: c.note,
    subject: c.emailMessage.subject,
    mailbox: c.emailMessage.connection.emailAddress,
    confidence: Number(c.confidenceScore),
  }));
  const accounts = options.accounts.filter((a) => a.kind !== "cash");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Sync"
        description="Import transactions from your bank and card alert emails in Gmail or Outlook. Matching alerts and statement rows become one transaction."
        actions={
          <div className="flex flex-wrap gap-2">
            {(["GMAIL", "OUTLOOK"] as const).map((p) =>
              providers[p] ? (
                <Button key={p} asChild variant={p === "GMAIL" ? "default" : "outline"}>
                  <a href={`/api/email/connect/${p.toLowerCase()}`}><Mail /> Connect {PROVIDER_LABEL[p]}</a>
                </Button>
              ) : (
                <Button key={p} variant="outline" disabled title={`${PROVIDER_LABEL[p]} isn't configured yet`}>
                  <Mail /> Connect {PROVIDER_LABEL[p]}
                </Button>
              ),
            )}
          </div>
        }
      />

      {error && <Alert variant="destructive"><AlertTriangle /><span>{error}</span></Alert>}
      {connected && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{connected.emailAddress} is connected. Press <strong>Sync now</strong> to read your recent bank alerts.</span>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connected mailboxes</CardTitle>
          <CardDescription className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Read-only access to alerts from bank senders. Your email password is never seen; access tokens are encrypted; email bodies are read in memory and not stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Inbox className="size-6 text-muted-foreground" />
              <p className="font-medium">No mailbox connected</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {providers.GMAIL || providers.OUTLOOK ? "Use Connect Gmail or Connect Outlook above." : "Email sync needs a one-time setup on this computer (below). Until then you can test the alert reader at the bottom of this page."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {connections.map((c) => {
                const st = STATUS[c.status] ?? { label: c.status, variant: "secondary" as const };
                const job = c.syncJobs[0];
                return (
                  <li key={c.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{c.emailAddress}</span>
                        <Badge variant="secondary">{PROVIDER_LABEL[c.provider]}</Badge>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {c.lastSyncAt ? `Last synced ${formatDate(c.lastSyncAt)} ${c.lastSyncAt.toISOString().slice(11, 16)} UTC` : "Never synced"} · {c._count.messages} alert{c._count.messages === 1 ? "" : "s"} processed
                        {job ? ` · last run: ${job.messagesFetched} read${job.failedCount ? `, ${job.failedCount} failed` : ""}` : ""}
                      </p>
                      {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.status === "EXPIRED" || c.status === "DISCONNECTED" ? (
                        <Button asChild size="sm" variant="outline"><a href={`/api/email/connect/${c.provider.toLowerCase()}`}>Reconnect</a></Button>
                      ) : (
                        <SyncNowButton id={c.id} firstSync={!c.lastSyncAt} />
                      )}
                      {c.status !== "DISCONNECTED" && <DisconnectButton id={c.id} address={c.emailAddress} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Alerts that need an account ({items.length})</CardTitle>
            <CardDescription>We read these alerts but couldn&apos;t tell which of your accounts they belong to. Choose one to add it, or ignore it.</CardDescription>
          </CardHeader>
          <CardContent>
            <UnplacedAlerts items={items} accounts={accounts} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>• Only messages from known bank and card senders are read (HDFC, ICICI, SBI, Axis, Kotak and 15 more).</p>
            <p>• OTPs, offers, statements, reminders and declined payments are skipped.</p>
            <p>• The account is matched by its last 4 digits — add them to your accounts and cards for automatic placement.</p>
            <p>• Clear alerts from a known bank are added straight away; anything uncertain waits in the <Link className="font-medium text-foreground underline underline-offset-2" href="/imports/review">Review Queue</Link>.</p>
            <p>• If the same transaction is already in your ledger (manual entry or statement), the alert is linked to it — never counted twice.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="size-4" /> One-time setup</CardTitle>
            <CardDescription>
              Gmail: {providers.GMAIL ? "configured ✓" : "not configured"} · Outlook: {providers.OUTLOOK ? "configured ✓" : "not configured"} · Token encryption: {providers.encryption ? "on ✓" : "missing"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Gmail:</strong> in Google Cloud Console create an OAuth client (Web application), enable the Gmail API, add the redirect URI <code className="break-all rounded bg-muted px-1">http://localhost:3010/api/email/callback/gmail</code>, add yourself as a test user, then put the client id/secret in <code>GMAIL_CLIENT_ID</code> / <code>GMAIL_CLIENT_SECRET</code> in .env and restart.</p>
            <p><strong className="text-foreground">Outlook:</strong> register an app in Microsoft Entra with redirect URI <code className="break-all rounded bg-muted px-1">http://localhost:3010/api/email/callback/outlook</code> and the delegated permission Mail.Read, then set <code>MICROSOFT_CLIENT_ID</code> / <code>MICROSOFT_CLIENT_SECRET</code>.</p>
            <p>Details are in the README (section “Email sync”).</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Try the alert reader</CardTitle>
          <CardDescription>Paste the text of a bank or card alert to see what FinSight360 would import. Nothing is saved.</CardDescription>
        </CardHeader>
        <CardContent>
          <ParserPlayground />
        </CardContent>
      </Card>
    </div>
  );
}
