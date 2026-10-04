"use client";
import * as React from "react";
import { CheckCircle2, FlaskConical, Loader2, RefreshCw, Unplug, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { disconnectEmailAction, previewAlertAction, resolveEmailCandidateAction, retryEmailCandidatesAction, syncEmailAction } from "@/features/email/actions";

export function SyncNowButton({ id, firstSync }: { id: string; firstSync: boolean }) {
  const [days, setDays] = React.useState(60);
  const [pending, start] = React.useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {firstSync && (
        <NativeSelect aria-label="How far back" className="h-9 w-auto md:h-9" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 6 months</option>
        </NativeSelect>
      )}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await syncEmailAction(id, days);
            if (!res.ok) return void toast.error(res.error);
            const s = res.data!;
            toast.success(
              s.fetched === 0
                ? "No new bank alerts since the last sync."
                : `Read ${s.fetched} alert${s.fetched === 1 ? "" : "s"}: ${s.transactions} added, ${s.linked} matched existing${s.needsAccount ? `, ${s.needsAccount} need an account` : ""}${s.notFinancial ? `, ${s.notFinancial} not transactions` : ""}.`,
            );
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {pending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}

export function DisconnectButton({ id, address }: { id: string; address: string }) {
  const [open, setOpen] = React.useState(false);
  const [deleteData, setDeleteData] = React.useState(false);
  const [pending, start] = React.useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setOpen(true)}>
        <Unplug /> Disconnect
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Disconnect ${address}?`} description="FinSight360's access is revoked and its stored tokens are deleted. Transactions already in your ledger are kept.">
          <CheckboxField id={`del-${id}`} label="Also delete the list of fetched alerts" hint="Removes subjects/dates of processed emails. Your transactions stay." checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await disconnectEmailAction(id, deleteData);
                  if (res.ok) {
                    toast.success(res.message ?? "Disconnected");
                    setOpen(false);
                  } else toast.error(res.error);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Disconnect
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type CandidateView = { id: string; date: string; amount: string; direction: "DEBIT" | "CREDIT"; description: string; merchant: string | null; note: string | null; subject: string; mailbox: string; confidence: number };

export function UnplacedAlerts({ items, accounts }: { items: CandidateView[]; accounts: { ref: string; label: string; kind: string }[] }) {
  const [choice, setChoice] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, start] = React.useTransition();
  const act = (id: string, action: "APPROVE" | "REJECT") => {
    setBusy(id);
    start(async () => {
      const res = await resolveEmailCandidateAction(id, action, choice[id] ?? null);
      setBusy(null);
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error(res.error);
    });
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            start(async () => {
              const res = await retryEmailCandidatesAction();
              if (res.ok) toast.success(res.data!.placed ? `Placed ${res.data!.placed} alert(s).` : "Still no matching accounts — add the last 4 digits to your accounts or choose one below.");
              else toast.error(res.error);
            })
          }
        >
          <RefreshCw /> Re-check accounts
        </Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {items.map((c) => (
          <li key={c.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{c.date}</span>
                <span>·</span>
                <span className="truncate">{c.mailbox}</span>
                <Badge variant="secondary">Confidence {c.confidence}%</Badge>
              </div>
              <p className="break-words text-sm font-medium">{c.merchant ?? c.subject}</p>
              <p className="break-words text-xs text-muted-foreground">{c.description}</p>
              {c.note && <p className="text-xs text-amber-700 dark:text-warning">{c.note}</p>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className={`tabular whitespace-nowrap text-right font-semibold ${c.direction === "CREDIT" ? "text-success" : ""}`}>
                {c.direction === "CREDIT" ? "+" : "−"}₹{Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
              <NativeSelect aria-label="Account" className="h-9 sm:w-56 md:h-9" value={choice[c.id] ?? ""} onChange={(e) => setChoice((s) => ({ ...s, [c.id]: e.target.value }))}>
                <option value="">Choose account…</option>
                {accounts.map((a) => <option key={a.ref} value={a.ref}>{a.label}</option>)}
              </NativeSelect>
              <div className="flex gap-1">
                <Button size="sm" disabled={!choice[c.id] || busy === c.id} onClick={() => act(c.id, "APPROVE")}>
                  {busy === c.id ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Add
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === c.id} onClick={() => act(c.id, "REJECT")} aria-label="Ignore alert">
                  <XCircle /> Ignore
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Preview = Awaited<ReturnType<typeof previewAlertAction>>;

export function ParserPlayground() {
  const [from, setFrom] = React.useState("alerts@hdfcbank.net");
  const [subject, setSubject] = React.useState("");
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<Preview | null>(null);
  const [pending, start] = React.useTransition();
  const data = result?.ok ? result.data : null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await previewAlertAction({ from, subject, text })));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="pf-from" label="From"><Input id="pf-from" value={from} onChange={(e) => setFrom(e.target.value)} /></FormField>
        <FormField id="pf-subject" label="Subject (optional)"><Input id="pf-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
      </div>
      <FormField id="pf-text" label="Alert text" error={result && !result.ok ? result.error : undefined}>
        <Textarea id="pf-text" rows={4} placeholder="Paste a bank or card alert, e.g. “Rs.645.00 has been debited from account **4821 to VPA swiggy@icici SWIGGY on 03-10-26…”" value={text} onChange={(e) => setText(e.target.value)} />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending || text.trim().length < 10}>
          {pending ? <Loader2 className="animate-spin" /> : <FlaskConical />} Read alert
        </Button>
      </div>
      {data && !data.ok && <p className="rounded-lg border bg-muted/40 p-3 text-sm">Not imported: <strong>{data.reason}</strong></p>}
      {data && data.ok && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <dt className="text-muted-foreground">Amount</dt><dd className="tabular font-semibold">{data.txn.direction === "CREDIT" ? "+" : "−"}₹{data.txn.amount}</dd>
          <dt className="text-muted-foreground">Type</dt><dd>{data.txn.transactionType.replace("_", " ").toLowerCase()}</dd>
          <dt className="text-muted-foreground">Date</dt><dd>{data.txn.transactionDate}</dd>
          <dt className="text-muted-foreground">{data.txn.instrument === "card" ? "Card" : "Account"}</dt><dd>{data.txn.cardLast4 && data.txn.instrument !== "bank" ? `••${data.txn.cardLast4}` : data.txn.accountLast4 ? `••${data.txn.accountLast4}` : "not stated"}</dd>
          <dt className="text-muted-foreground">Merchant</dt><dd>{data.txn.merchantName ?? "—"}</dd>
          <dt className="text-muted-foreground">Reference</dt><dd className="break-all">{data.txn.referenceNumber ?? "—"}</dd>
          <dt className="text-muted-foreground">Bank</dt><dd>{data.txn.bank ?? "Unknown sender"}</dd>
          <dt className="text-muted-foreground">Confidence</dt><dd>{data.txn.confidence}% {data.txn.confidence >= 85 ? "(added automatically)" : "(waits in Review Queue)"}</dd>
        </dl>
      )}
    </form>
  );
}
