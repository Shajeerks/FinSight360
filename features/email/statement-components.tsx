"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, KeyRound, Loader2, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { connectImapAction, dismissEmailStatementAction, importEmailStatementAction } from "@/features/email/actions";

const HOSTS: [RegExp, string, string][] = [
  [/@(gmail|googlemail)\.com$/i, "imap.gmail.com", "Google Account → Security → 2-Step Verification → App passwords"],
  [/@(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/i, "imap.mail.yahoo.com", "Yahoo Account Security → Generate app password"],
  [/@(outlook|hotmail|live|msn)\.[a-z.]+$/i, "outlook.office365.com", "Microsoft account → Security → App passwords"],
];

/** Connect Gmail / Yahoo / another mailbox with an app password (IMAP). */
export function ConnectWithAppPassword({ email: initialEmail, variant = "default" }: { email?: string; variant?: "default" | "outline" | "ghost" }) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState(initialEmail ?? "");
  const [password, setPassword] = React.useState("");
  const [host, setHost] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, start] = React.useTransition();
  const known = HOSTS.find(([re]) => re.test(email.trim()));
  return (
    <>
      <Button variant={variant} size={initialEmail ? "sm" : "default"} onClick={() => setOpen(true)}>
        {initialEmail ? "Reconnect" : <><KeyRound /> Connect with app password</>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={initialEmail ? `Reconnect ${initialEmail}` : "Connect a mailbox with an app password"}
          description="Works with Gmail, Yahoo Mail and most other mailboxes. FinSight360 only reads emails from bank senders, opens your inbox read-only and never sends or deletes mail."
        >
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              start(async () => {
                const res = await connectImapAction({ email, appPassword: password, host: known ? "" : host });
                if (!res.ok) {
                  const fe = Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
                  setErrors(fe);
                  return void toast.error(res.error);
                }
                setPassword("");
                setOpen(false);
                toast.success(`${res.data!.emailAddress} is connected. Press Sync now to read your bank emails and statements.`);
              });
            }}
          >
            <FormField id="imap-email" label="Email address" error={errors.email}>
              <Input id="imap-email" type="email" autoComplete="email" value={email} readOnly={Boolean(initialEmail)} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" required />
            </FormField>
            <FormField
              id="imap-pass"
              label="App password"
              error={errors.appPassword}
              hint={known ? `Create one at: ${known[2]}. It is not your normal password.` : "Create an app password in your email account's security settings. It is not your normal password."}
            >
              <Input id="imap-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="abcd efgh ijkl mnop" required />
            </FormField>
            {!known && email.includes("@") && (
              <FormField id="imap-host" label="IMAP server" error={errors.host} hint="Leave empty if unsure — common providers are filled in automatically.">
                <Input id="imap-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" />
              </FormField>
            )}
            <p className="text-xs text-muted-foreground">The app password is checked once, then stored encrypted. Disconnect any time here, or delete the app password at your provider to cut access immediately.</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending || !email || password.replace(/\s/g, "").length < 8}>
                {pending ? <Loader2 className="animate-spin" /> : <Mail />} {pending ? "Checking…" : "Connect"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type StatementView = {
  id: string;
  fileName: string;
  from: string;
  subject: string;
  received: string;
  mailbox: string;
  suggestedAccount: string | null;
  needsPassword: boolean;
  isPdf: boolean;
  error: string | null;
};

/** Statements found in your mailboxes that still need an account and/or the PDF password. */
export function PendingStatements({ items, accounts }: { items: StatementView[]; accounts: { ref: string; label: string }[] }) {
  const router = useRouter();
  const [account, setAccount] = React.useState<Record<string, string>>(() => Object.fromEntries(items.filter((i) => i.suggestedAccount).map((i) => [i.id, i.suggestedAccount!])));
  const [password, setPassword] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, start] = React.useTransition();

  const read = (s: StatementView) => {
    setBusy(s.id);
    start(async () => {
      const res = await importEmailStatementAction(s.id, account[s.id] ?? "", password[s.id]?.trim() || null);
      setBusy(null);
      if (!res.ok) return void toast.error(res.error);
      setPassword((p) => ({ ...p, [s.id]: "" }));
      toast.success("Statement read — check the rows, then add them.");
      router.push(`/imports/${res.data!.importId}`);
    });
  };
  const dismiss = (id: string) => {
    setBusy(id);
    start(async () => {
      const res = await dismissEmailStatementAction(id);
      setBusy(null);
      if (res.ok) toast.success(res.message ?? "Ignored");
      else toast.error(res.error);
    });
  };

  return (
    <ul className="divide-y rounded-xl border">
      {items.map((s) => (
        <li key={s.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0 space-y-1">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <FileText className="size-4 shrink-0 text-primary" />
              <span className="truncate">{s.fileName}</span>
              {s.needsPassword && <Badge variant="warning" className="shrink-0">Password needed</Badge>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{s.subject}</p>
            <p className="truncate text-xs text-muted-foreground">{s.received} · {s.from} · in {s.mailbox}</p>
            {s.error && <p className="text-xs text-amber-700 dark:text-warning">{s.error}</p>}
          </div>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end"
            onSubmit={(e) => {
              e.preventDefault();
              read(s);
            }}
          >
            <NativeSelect aria-label="Account" className="h-9 sm:w-56 md:h-9" value={account[s.id] ?? ""} onChange={(e) => setAccount((a) => ({ ...a, [s.id]: e.target.value }))}>
              <option value="">Choose account…</option>
              {accounts.map((a) => <option key={a.ref} value={a.ref}>{a.label}</option>)}
            </NativeSelect>
            {s.isPdf && (
              <Input
                aria-label="PDF password"
                type="password"
                autoComplete="off"
                className="h-9 sm:w-44"
                placeholder={s.needsPassword ? "PDF password" : "PDF password (if any)"}
                value={password[s.id] ?? ""}
                onChange={(e) => setPassword((p) => ({ ...p, [s.id]: e.target.value }))}
              />
            )}
            <div className="flex gap-1">
              <Button type="submit" size="sm" disabled={!account[s.id] || busy === s.id || (s.needsPassword && !password[s.id]?.trim())}>
                {busy === s.id ? <Loader2 className="animate-spin" /> : <FileText />} Read statement
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy === s.id} onClick={() => dismiss(s.id)} aria-label="Ignore statement">
                <XCircle /> Ignore
              </Button>
            </div>
          </form>
        </li>
      ))}
    </ul>
  );
}
