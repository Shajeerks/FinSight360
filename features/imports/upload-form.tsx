"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/dates";

type AccountOption = { ref: string; label: string; kind: "bank" | "card" };

const MAX_BYTES = 10 * 1024 * 1024;

/** Upload goes to POST /api/imports as multipart (server actions cap bodies at 1 MB). */
export function UploadStatementForm({ accounts }: { accounts: AccountOption[] }) {
  const router = useRouter();
  const [account, setAccount] = React.useState(accounts[0]?.ref ?? "");
  const [file, setFile] = React.useState<File | null>(null);
  const [password, setPassword] = React.useState("");
  const [needsPassword, setNeedsPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!account) errs.account = "Choose the account this statement belongs to";
    if (!file) errs.file = "Choose a CSV, XLSX or PDF file";
    else if (file.size > MAX_BYTES) errs.file = "Files up to 10 MB are supported";
    setErrors(errs);
    if (Object.keys(errs).length || !file) return;

    setBusy(true);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("account", account);
    if (password) fd.set("password", password);
    try {
      const res = await fetch("/api/imports", { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as { data?: { id: string; previousImportAt: string | null }; error?: { code: string; message: string } } | null;
      if (!res.ok || !body?.data) {
        const code = body?.error?.code;
        if (code === "PDF_PASSWORD_REQUIRED" || code === "PDF_PASSWORD_INCORRECT") {
          setNeedsPassword(true);
          setErrors({ password: code === "PDF_PASSWORD_INCORRECT" ? "That password didn't open the PDF" : "This PDF is protected — enter its password" });
        } else {
          toast.error(body?.error?.message ?? "Upload failed. Please try again.");
        }
        return;
      }
      if (body.data.previousImportAt) {
        toast.warning(`This exact file was already imported on ${formatDate(new Date(body.data.previousImportAt))}. Rows already in your ledger will be skipped.`);
      }
      setPassword("");
      router.push(`/imports/${body.data.id}`);
    } catch {
      toast.error("Network error — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!accounts.length) {
    return <Alert>Add a bank account or credit card first — every statement is imported into one of them.</Alert>;
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <FormField id="import-account" label="Statement of" error={errors.account}>
        <NativeSelect id="import-account" value={account} onChange={(e) => setAccount(e.target.value)} aria-invalid={Boolean(errors.account)}>
          <optgroup label="Bank accounts">
            {accounts.filter((a) => a.kind === "bank").map((a) => <option key={a.ref} value={a.ref}>{a.label}</option>)}
          </optgroup>
          <optgroup label="Credit cards">
            {accounts.filter((a) => a.kind === "card").map((a) => <option key={a.ref} value={a.ref}>{a.label}</option>)}
          </optgroup>
        </NativeSelect>
      </FormField>

      <FormField id="import-file" label="Statement file" error={errors.file} hint="CSV, XLSX or text PDF · up to 10 MB">
        <label
          htmlFor="import-file"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 focus-within:ring-[3px] focus-within:ring-ring/40"
        >
          <FileUp className="size-6 text-primary" />
          <span className="text-sm font-medium">{file ? file.name : "Tap to choose a file"}</span>
          {file && <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>}
          <input
            id="import-file"
            type="file"
            accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setNeedsPassword(false);
              setPassword("");
              setErrors({});
            }}
          />
        </label>
      </FormField>

      {(needsPassword || file?.name.toLowerCase().endsWith(".pdf")) && (
        <FormField id="import-password" label="PDF password (if protected)" error={errors.password} hint="Used once to open the file. It is never saved or logged.">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="import-password" type="password" autoComplete="off" className="pl-9" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} />
          </div>
        </FormField>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-success" /> Nothing is added until you review and confirm.</p>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <FileUp />} {busy ? "Reading statement…" : "Upload & preview"}
        </Button>
      </div>
    </form>
  );
}
