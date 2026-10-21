import type { Metadata } from "next";
import Link from "next/link";
import { LineChart, Mail } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getConnectedAccounts } from "@/services/settings.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Connected accounts" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  ACTIVE: { label: "Active", variant: "success" },
  EXPIRED: { label: "Reconnect needed", variant: "warning" },
  ERROR: { label: "Error", variant: "destructive" },
  DISCONNECTED: { label: "Disconnected", variant: "secondary" },
};

export default async function ConnectedAccountsPage() {
  const user = await requireUser();
  const { investments, mailboxes } = await getConnectedAccounts(user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Connected Accounts" description="Where FinSight360 gets your data from besides what you enter yourself." />

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><LineChart className="size-4" /> Investments (Groww & others)</CardTitle>
            <CardDescription>Groww is updated from the statements you download from Groww — FinSight360 never asks for your Groww password or OTP.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline"><Link href="/investments">Open Investments</Link></Button>
        </CardHeader>
        <CardContent className="p-0">
          {investments.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No investment accounts yet. Add one on the Investments page, then use <strong>Import from Groww</strong> on it.</p>
          ) : (
            <ul className="divide-y">
              {investments.map((a) => {
                const job = a.groww?.syncJobs[0];
                const st = a.groww ? STATUS[a.groww.status] : null;
                return (
                  <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Link href={`/investments`} className="font-medium hover:underline">{a.name}</Link>
                      <p className="text-xs text-muted-foreground">
                        {a.providerName ?? "Manual"} · {a._count.holdings} holding{a._count.holdings === 1 ? "" : "s"}
                        {job ? ` · last import ${fmt.format(job.startedAt)} (${job.fileName ?? "file"}: ${job.holdingsUpserted} holdings, ${job.transactionsImported} transactions)` : a.groww ? "" : " · entered manually"}
                      </p>
                      {a.groww?.lastError && <p className="text-xs text-destructive">{a.groww.lastError}</p>}
                    </div>
                    {st ? <Badge variant={st.variant}>Groww file import · {st.label}</Badge> : <Badge variant="secondary">Manual</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Mail className="size-4" /> Email (Gmail & Outlook)</CardTitle>
            <CardDescription>Read-only access to bank alert emails, used to add transactions automatically.</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline"><Link href="/imports/email">Manage</Link></Button>
        </CardHeader>
        <CardContent className="p-0">
          {mailboxes.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No mailbox connected. Connect Gmail or Outlook from <Link href="/imports/email" className="underline underline-offset-2">Email Sync</Link>.</p>
          ) : (
            <ul className="divide-y">
              {mailboxes.map((m) => {
                const st = STATUS[m.status];
                return (
                  <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.emailAddress}</p>
                      <p className="text-xs text-muted-foreground">{m.provider === "GMAIL" ? "Gmail" : "Outlook"} · {m.lastSyncAt ? `last synced ${fmt.format(m.lastSyncAt)}` : "not synced yet"}</p>
                      {m.lastError && <p className="text-xs text-destructive">{m.lastError}</p>}
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
