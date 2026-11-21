import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Inbox, Lock, Mail, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/dates";
import { connectionLabel, emailProvidersStatus, listEmailCandidates, listEmailConnections, listEmailStatements, PROVIDER_LABEL } from "@/services/email.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { DisconnectButton, ParserPlayground, SyncNowButton, UnplacedAlerts, type CandidateView } from "@/features/email/email-components";
import { ConnectWithAppPassword, PendingStatements, type StatementView } from "@/features/email/statement-components";

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
  const [connections, candidates, options, statements] = await Promise.all([
    listEmailConnections(user.id),
    listEmailCandidates(user.id),
    getTransactionFormOptions(user.id),
    listEmailStatements(user.id),
  ]);
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
  const accountLabel = new Map(accounts.map((a) => [a.ref, a.label]));
  const pendingStatements: StatementView[] = statements.pending.map((s) => ({
    id: s.id,
    fileName: s.fileName,
    from: s.fromAddress,
    subject: s.subject,
    received: formatDate(s.receivedAt),
    mailbox: s.connection.emailAddress,
    suggestedAccount: s.suggestedAccount && accountLabel.has(s.suggestedAccount) ? s.suggestedAccount : null,
    needsPassword: s.needsPassword,
    isPdf: /\.pdf$/i.test(s.fileName) || s.fileName.toLowerCase().endsWith("pdf"),
    error: s.errorMessage,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Sync"
        description="Connect every mailbox your bank and card emails go to (Gmail, Yahoo and more). Alerts become transactions, and statements attached to emails are picked up for you to review."
        actions={
          <div className="flex flex-wrap gap-2">
            <ConnectWithAppPassword />
            {(["GMAIL", "OUTLOOK"] as const)
              .filter((p) => providers[p])
              .map((p) => (
                <Button key={p} asChild variant="outline">
                  <a href={`/api/email/connect/${p.toLowerCase()}`}><Mail /> Sign in with {PROVIDER_LABEL[p]}</a>
                </Button>
              ))}
          </div>
        }
      />

      {error && <Alert variant="destructive"><AlertTriangle /><span>{error}</span></Alert>}
      {connected && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{connected.emailAddress} is connected. Press <strong>Sync now</strong> to read your recent bank alerts and statements.</span>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connected mailboxes</CardTitle>
          <CardDescription className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Read-only access to emails from bank senders. App passwords and access tokens are stored encrypted; email bodies are read in memory and not stored. Every mailbox is checked automatically once a day (about 7 AM).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Inbox className="size-6 text-muted-foreground" />
              <p className="font-medium">No mailbox connected</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Use <strong>Connect with app password</strong> above for each mailbox your bank or card emails go to — for example your HDFC account emails in Gmail and your card emails in Yahoo.
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
                        <Badge variant="secondary">{connectionLabel(c)}</Badge>
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
                        c.provider === "IMAP" ? (
                          <ConnectWithAppPassword email={c.emailAddress} variant="outline" />
                        ) : (
                          <Button asChild size="sm" variant="outline"><a href={`/api/email/connect/${c.provider.toLowerCase()}`}>Reconnect</a></Button>
                        )
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

      <Card id="statements">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="size-4 text-primary" /> Statements from your email</CardTitle>
          <CardDescription>
            PDF, CSV and Excel statements attached to bank and card emails. When the account is clear and the file isn&apos;t locked, it&apos;s read straight away and waits for your review. Otherwise choose the account and type the PDF password — the password is used once and never stored.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingStatements.length > 0 ? (
            <PendingStatements items={pendingStatements} accounts={accounts.map((a) => ({ ref: a.ref, label: a.label }))} />
          ) : (
            <p className="text-sm text-muted-foreground">{connections.length ? "No statements waiting. New ones appear here after each sync." : "Connect a mailbox to pick up statements automatically."}</p>
          )}
          {statements.recent.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Recently read</p>
              <ul className="divide-y rounded-xl border text-sm">
                {statements.recent.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatDate(s.receivedAt)} · {s.suggestedAccount ? (accountLabel.get(s.suggestedAccount) ?? "Account removed") : ""} · {s.connection.emailAddress}</p>
                    </div>
                    {s.importId && (
                      <Link href={`/imports/${s.importId}`} className="shrink-0 text-xs font-medium text-primary hover:underline">
                        {s.importStatus === "COMPLETED" ? "Added — view import" : s.importStatus === "CANCELLED" || s.importStatus === "FAILED" ? "Import cancelled" : "Review and add →"}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
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
            <p>• OTPs, offers, reminders and declined payments are skipped. Statement attachments are listed under <em>Statements from your email</em>.</p>
            <p>• The account is matched by its last 4 digits — add them to your accounts and cards for automatic placement.</p>
            <p>• Clear alerts from a known bank are added straight away; anything uncertain waits in the <Link className="font-medium text-foreground underline underline-offset-2" href="/imports/review">Review Queue</Link>.</p>
            <p>• If the same transaction is already in your ledger (manual entry or statement), the alert is linked to it — never counted twice.</p>
            <p>• A statement read from email goes through the same review screen as an upload: nothing is added until you confirm it.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Lock className="size-4" /> Getting an app password</CardTitle>
            <CardDescription>An app password lets FinSight360 read your mail without your real password. You can delete it at your provider any time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p><strong className="text-foreground">Gmail:</strong> turn on 2-Step Verification, then open <span className="text-foreground">myaccount.google.com/apppasswords</span>, create one named “FinSight360” and paste the 16 letters here.</p>
            <p><strong className="text-foreground">Yahoo Mail:</strong> Account Info → Account security → <span className="text-foreground">Generate app password</span> (name it “FinSight360”) and paste it here.</p>
            <p><strong className="text-foreground">Others:</strong> look for “app password” in the account&apos;s security settings; you may also need the IMAP server name.</p>
            {(providers.GMAIL || providers.OUTLOOK) && <p className="text-xs">Sign in with Gmail / Outlook (OAuth) is also set up on this instance.</p>}
            {!providers.encryption && <p className="text-xs text-destructive">TOKEN_ENCRYPTION_KEY is missing — add it to the environment before connecting a mailbox.</p>}
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
