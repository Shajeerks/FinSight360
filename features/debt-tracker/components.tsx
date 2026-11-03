"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, FileSpreadsheet, FileUp, Loader2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Alert } from "@/components/ui/alert";
import { inr } from "@/features/dashboard/format-client";
import { applyAllEmisAction, applyEmiAction, deleteDebtLenderAction, saveDebtMonthAction, saveDebtLenderAction, undoDebtExcelAction } from "@/features/debt-tracker/actions";

// ───────────────────────────── edit one lender's month ─────────────────────────────

export const FIELD_LABELS = {
  opening: "Total outstanding (start of month)",
  newBorrowing: "New spends / borrowing",
  payment: "Current month payment",
  paidToDate: "Paid by this month",
  interest: "Interest & charges this month",
  closing: "Remaining balance (end of month)",
  remainingEmis: "Remaining EMI count",
} as const;
type FieldKey = keyof typeof FIELD_LABELS;
const API_FIELD: Record<FieldKey, string> = {
  opening: "openingOutstanding",
  newBorrowing: "newBorrowing",
  payment: "payment",
  paidToDate: "paidToDate",
  interest: "interest",
  closing: "closingOutstanding",
  remainingEmis: "remainingEmis",
};

export type EditRowData = {
  key: string;
  name: string;
  kind: "CARD" | "LOAN" | "PERSON" | "OTHER";
  month: string;
  monthLabel: string;
  values: Record<FieldKey, string | null>;
  entered: string[];
  /** Card: this month's bill (read from an uploaded statement, typed in, or from the card). */
  bill: { statementDate: string; dueDate: string; totalDue: string; minimumDue: string; purchases: string; financeCharges: string; source: "upload" | "manual" | "card" } | null;
  /** Loans / other lenders: the due date you entered, and the automatic one. */
  dueDate: string;
  autoDueDate: string | null;
};

type BillForm = { statementDate: string; dueDate: string; totalDue: string; minimumDue: string; purchases: string; financeCharges: string };
const BILL_LABELS: Record<keyof BillForm, string> = {
  statementDate: "Statement date",
  dueDate: "Payment due date",
  totalDue: "Total amount due",
  minimumDue: "Minimum amount due",
  purchases: "Purchases / spends on the bill",
  financeCharges: "Interest & charges on the bill",
};

const num = (v: string | null | undefined) => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const filled = (v: string) => v.trim() !== "";

export function EditEntryDialog({ row }: { row: EditRowData }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const isCard = row.kind === "CARD";
  const initial = React.useCallback(
    () => Object.fromEntries((Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => [k, row.entered.includes(k) ? (row.values[k] ?? "") : ""])) as Record<FieldKey, string>,
    [row],
  );
  const initialBill = React.useCallback(
    (): BillForm => ({
      statementDate: row.bill?.statementDate ?? "",
      dueDate: row.bill?.dueDate ?? "",
      totalDue: row.bill?.totalDue ?? "",
      minimumDue: row.bill?.minimumDue ?? "",
      purchases: row.bill?.purchases ?? "",
      financeCharges: row.bill?.financeCharges ?? "",
    }),
    [row],
  );
  const [form, setForm] = React.useState<Record<FieldKey, string>>(initial);
  const [bill, setBill] = React.useState<BillForm>(initialBill);
  const [billDirty, setBillDirty] = React.useState(false);
  const [dueDate, setDueDate] = React.useState(row.dueDate);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const fields = (Object.keys(FIELD_LABELS) as FieldKey[]).filter((k) => k !== "remainingEmis" || row.kind === "LOAN" || row.entered.includes("remainingEmis"));

  // Live working: what the month will show with the figures typed so far.
  const value = (k: FieldKey) => (filled(form[k]) ? num(form[k]) : num(row.values[k]));
  const opening = value("opening");
  const spends = filled(form.newBorrowing) ? num(form.newBorrowing) : isCard && billDirty && filled(bill.purchases) ? num(bill.purchases) : num(row.values.newBorrowing);
  const payment = value("payment");
  let closing: number;
  let interest: number;
  const billClosing = isCard && filled(bill.totalDue) && (billDirty || row.bill) ? num(bill.totalDue) : null;
  if (filled(form.closing) && filled(form.interest)) {
    closing = num(form.closing);
    interest = num(form.interest);
  } else if (filled(form.closing) || billClosing !== null) {
    closing = filled(form.closing) ? num(form.closing) : billClosing!;
    interest = closing - opening - spends + payment;
  } else if (filled(form.interest)) {
    interest = num(form.interest);
    closing = opening + spends - payment + interest;
  } else {
    interest = num(row.values.interest);
    closing = opening + spends - payment + interest;
  }
  const gap = filled(form.closing) && filled(form.interest) ? closing - (opening + spends - payment + interest) : 0;

  const save = (values: Record<FieldKey, string>, reset = false) =>
    start(async () => {
      const entry: Record<string, string> = { month: row.month, lenderKey: row.key, dueDate: reset || isCard ? "" : dueDate };
      for (const k of Object.keys(values) as FieldKey[]) entry[API_FIELD[k]] = values[k].trim();
      // The bill keeps its own month (a statement from last month stays last month's bill).
      const billMonth = row.bill?.statementDate ? row.bill.statementDate.slice(0, 7) : row.month;
      const billPayload = isCard && billDirty && !reset ? { cardId: row.key.slice(5), month: billMonth, ...bill } : null;
      const res = await saveDebtMonthAction(entry, billPayload);
      if (!res.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) {
          const f = (Object.keys(API_FIELD) as FieldKey[]).find((x) => API_FIELD[x] === k);
          fe[f ?? `bill.${k}`] = v[0];
          if (k === "dueDate") fe.dueDate = v[0];
        }
        setErrors(fe);
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setForm(initial()); setBill(initialBill()); setBillDirty(false); setDueDate(row.dueDate); setErrors({}); } }}>
      <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${row.name} for ${row.monthLabel}`} onClick={() => setOpen(true)}>
        <Pencil />
      </Button>
      <DialogContent className="sm:max-w-2xl" title={`${row.name} · ${row.monthLabel}`} description="Leave a box empty and FinSight360 calculates it from your statements, transactions and loan schedule. Type a figure (e.g. from the lender's statement) to use it instead.">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(form);
          }}
        >
          {isCard ? (
            <fieldset className="grid gap-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">{row.bill && row.bill.statementDate.slice(0, 7) !== row.month ? "Card bill due this month (last statement)" : "Card bill (statement)"}</legend>
              <p className="-mt-1 text-xs text-muted-foreground">
                {row.bill?.source === "upload"
                  ? "Read from your uploaded card statement — correct any figure if needed."
                  : row.bill?.source === "manual"
                    ? "Entered by you. Clear the total due to remove it."
                    : row.bill?.source === "card"
                      ? "From the card's details. Saving here keeps it as this month's bill."
                      : "Upload the card statement PDF and this fills in by itself — or type it from the bill (any past statement date). The total due becomes the remaining balance of the statement's month."}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(Object.keys(BILL_LABELS) as (keyof BillForm)[]).map((k) => (
                  <FormField key={k} id={`bill-${k}`} label={BILL_LABELS[k]} error={errors[`bill.${k}`]}>
                    <Input
                      id={`bill-${k}`}
                      type={k === "statementDate" || k === "dueDate" ? "date" : "text"}
                      inputMode={k === "statementDate" || k === "dueDate" ? undefined : "decimal"}
                      max={k === "statementDate" ? new Date().toISOString().slice(0, 10) : undefined}
                      value={bill[k]}
                      onChange={(e) => { setBill((b) => ({ ...b, [k]: e.target.value })); setBillDirty(true); }}
                    />
                  </FormField>
                ))}
              </div>
            </fieldset>
          ) : (
            <FormField id="de-due" label="Payment due date" error={errors.dueDate} hint={dueDate ? "Entered by you" : row.autoDueDate ? `Auto: ${row.autoDueDate} (EMI schedule)` : "Optional"}>
              <Input id="de-due" type="date" className="sm:max-w-56" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </FormField>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((k) => (
              <FormField
                key={k}
                id={`de-${k}`}
                label={FIELD_LABELS[k]}
                error={errors[k]}
                hint={filled(form[k]) ? "Entered by you" : `Auto: ${row.values[k] === null ? "—" : k === "remainingEmis" ? row.values[k] : inr(Number(row.values[k]))}`}
              >
                <Input
                  id={`de-${k}`}
                  inputMode={k === "remainingEmis" ? "numeric" : "decimal"}
                  placeholder={row.values[k] === null ? "" : k === "remainingEmis" ? String(row.values[k]) : Number(row.values[k]).toFixed(2)}
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                />
              </FormField>
            ))}
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite">
            <p className="font-medium">This month will show</p>
            <p className="tabular mt-1 text-xs text-muted-foreground">
              {inr(opening)} + {inr(spends)} new − {inr(payment)} paid + {inr(interest)} interest =
            </p>
            <p className="tabular mt-0.5">
              Remaining balance <b>{inr(closing)}</b> · Interest & charges <b className={interest < 0 ? "text-amber-700 dark:text-warning" : ""}>{inr(interest)}</b>
            </p>
            {interest < 0 && <p className="mt-1 text-xs text-amber-700 dark:text-warning">Interest is negative — check the payment, spends or balance figures.</p>}
            {Math.abs(gap) >= 0.01 && <p className="mt-1 text-xs text-amber-700 dark:text-warning">Your remaining balance and interest differ by {inr(gap)}.</p>}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="ghost" disabled={pending || (row.entered.length === 0 && !row.dueDate)} onClick={() => save(Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, ""])) as Record<FieldKey, string>, true)}>
              <RotateCcw /> Back to automatic
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── other lenders ─────────────────────────────

export type LenderData = { id: string; name: string; kind: "PERSON" | "OTHER"; matchText: string | null; openingOutstanding: string; openingDate: string; monthlyRatePct: string; notes: string | null; closed: boolean };

export function LenderDialog({ lender, trigger }: { lender?: LenderData; trigger?: "button" | "icon" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const blank = React.useCallback(
    (): LenderData => lender ?? { id: "", name: "", kind: "PERSON", matchText: "", openingOutstanding: "0", openingDate: "", monthlyRatePct: "0", notes: "", closed: false },
    [lender],
  );
  const [form, setForm] = React.useState<LenderData>(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof LenderData>(k: K, v: LenderData[K]) => setForm((f) => ({ ...f, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const res = await saveDebtLenderAction(lender?.id ?? null, { ...form, matchText: form.matchText ?? "", notes: form.notes ?? "" });
      if (!res.ok) {
        setErrors(Object.fromEntries(Object.entries(res.fieldErrors ?? {}).map(([k, v]) => [k, v[0]])));
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setForm(blank()); setErrors({}); } }}>
      {trigger === "icon" ? (
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${lender?.name}`} onClick={() => setOpen(true)}><Pencil /></Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> Add other lender</Button>
      )}
      <DialogContent title={lender ? `Edit ${lender.name}` : "Add a lender"} description="For money borrowed from a person, a chit fund, a gold loan or any lender that isn't a card or a loan in Loans & EMI.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="dl-name" label="Lender name" error={errors.name}>
              <Input id="dl-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Ravi (friend)" />
            </FormField>
            <FormField id="dl-kind" label="Type">
              <NativeSelect id="dl-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as LenderData["kind"])}>
                <option value="PERSON">A person (friend / family)</option>
                <option value="OTHER">Other lender</option>
              </NativeSelect>
            </FormField>
            <FormField id="dl-opening" label="Owed when you started tracking (₹)" error={errors.openingOutstanding}>
              <Input id="dl-opening" inputMode="decimal" value={form.openingOutstanding} onChange={(e) => set("openingOutstanding", e.target.value)} />
            </FormField>
            <FormField id="dl-date" label="As on" hint="Leave empty for today" error={errors.openingDate}>
              <Input id="dl-date" type="date" value={form.openingDate} onChange={(e) => set("openingDate", e.target.value)} />
            </FormField>
            <FormField id="dl-rate" label="Interest per month (%)" hint="e.g. 1.5 · 0 if interest-free" error={errors.monthlyRatePct}>
              <Input id="dl-rate" inputMode="decimal" value={form.monthlyRatePct} onChange={(e) => set("monthlyRatePct", e.target.value)} />
            </FormField>
            <FormField id="dl-match" label="Find in transactions by" hint="Text in the bank narration, e.g. RAVI KUMAR" error={errors.matchText}>
              <Input id="dl-match" value={form.matchText ?? ""} onChange={(e) => set("matchText", e.target.value)} placeholder={form.name || "Same as the name"} />
            </FormField>
          </div>
          <FormField id="dl-notes" label="Notes" error={errors.notes}>
            <Textarea id="dl-notes" rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </FormField>
          {lender && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.closed} onChange={(e) => set("closed", e.target.checked)} /> Fully repaid — stop showing in new months
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            Money you receive from them or pay back is picked up from transactions marked <b>Loan / borrowing received</b> or <b>Lent / borrowing repaid</b> whose description contains the text above.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {lender ? <DeleteLenderButton id={lender.id} name={lender.name} onDone={() => setOpen(false)} /> : <span />}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteLenderButton({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="text-muted-foreground hover:text-destructive"
      title={`Remove ${name}?`}
      description="The lender and the figures you entered for them are removed from the tracker. Your transactions are not changed."
      confirmLabel="Remove"
      onConfirm={async () => {
        const res = await deleteDebtLenderAction(id);
        if (res.ok) {
          onDone();
          router.refresh();
        }
        return res;
      }}
    >
      <Trash2 /> Remove
    </ConfirmButton>
  );
}

// ───────────────────────────── EMIs from bank statements ─────────────────────────────

export function ApplyEmiButton({ loanId, transactionId, label = "Apply to loan" }: { loanId: string; transactionId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await applyEmiAction(loanId, transactionId);
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.message ?? "Applied");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} {label}
    </Button>
  );
}

export function ApplyAllEmisButton({ month, count }: { month: string; count: number }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      size="sm"
      disabled={pending || count === 0}
      onClick={() =>
        start(async () => {
          const res = await applyAllEmisAction(month);
          if (!res.ok) return void toast.error(res.error);
          const r = res.data ?? { applied: 0, failed: [] };
          if (r.applied) toast.success(`${r.applied} EMI(s) applied to your loans.`);
          for (const f of r.failed) toast.error(f);
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Apply all {count} to loans
    </Button>
  );
}

export function AssignEmi({ transactionId, loans }: { transactionId: string; loans: { id: string; label: string }[] }) {
  const [loanId, setLoanId] = React.useState(loans[0]?.id ?? "");
  if (!loans.length) return <span className="text-xs text-muted-foreground">Add the loan in Loans & EMI first</span>;
  return (
    <div className="flex items-center gap-2">
      <NativeSelect aria-label="Loan" className="h-8 max-w-52 text-xs" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
        {loans.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </NativeSelect>
      <ApplyEmiButton loanId={loanId} transactionId={transactionId} label="Apply" />
    </div>
  );
}

// ───────────────────────────── Excel history ─────────────────────────────

type ExcelRow = { month: string; lender: string; openingOutstanding: string | null; payment: string | null; paidToDate: string | null; closingOutstanding: string | null; interest: string | null; remainingEmis: number | null };
type ExcelPreview = { rows: ExcelRow[]; sheets: { name: string; month: string | null; rows: number; skipped?: string }[]; lenders: string[]; warnings: string[]; options: { value: string; label: string }[]; suggestions: Record<string, string> };

export function ExcelImportDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<ExcelPreview | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reset = () => { setFile(null); setPreview(null); setMapping({}); setError(null); setOverwrite(false); };

  async function read(f: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", f);
    try {
      const res = await fetch("/api/debt-tracker/excel", { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as { data?: ExcelPreview; error?: { message: string } } | null;
      if (!res.ok || !body?.data) return void setError(body?.error?.message ?? "Couldn't read the file.");
      setPreview(body.data);
      setMapping(body.data.suggestions);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/debt-tracker/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: preview.rows, mapping, overwrite }) });
      const body = (await res.json().catch(() => null)) as { data?: { saved: number; skipped: number; kept: number; lendersCreated: number }; error?: { message: string } } | null;
      if (!res.ok || !body?.data) return void setError(body?.error?.message ?? "Import failed.");
      const d = body.data;
      toast.success(`Imported ${d.saved} month row(s)${d.lendersCreated ? `, added ${d.lendersCreated} lender(s)` : ""}${d.kept ? `, kept ${d.kept} you'd already entered` : ""}.`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const months = preview ? [...new Set(preview.rows.map((r) => r.month))] : [];
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><FileSpreadsheet /> Import Excel history</Button>
      <DialogContent className="sm:max-w-2xl" title="Import your Excel debt sheets" description="One sheet per month with columns like Lender name, Total outstanding, Current month payment, Paid by this month, Remaining balance, Interest, Remaining EMI count. Totals rows are ignored. Nothing is saved until you press Import.">
        <div className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <label htmlFor="de-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center hover:border-primary/50">
            {busy && !preview ? <Loader2 className="size-5 animate-spin text-primary" /> : <FileUp className="size-5 text-primary" />}
            <span className="text-sm font-medium">{file ? file.name : "Choose your Excel workbook (.xlsx)"}</span>
            <input id="de-file" type="file" className="sr-only" accept=".xlsx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(null); if (f) void read(f); }} />
          </label>
          {preview && (
            <>
              <div className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{preview.rows.length} lender row(s) across {months.length} month(s)</p>
                <p className="text-xs text-muted-foreground">Sheets: {preview.sheets.map((s) => `${s.name}${s.skipped ? " (skipped)" : ` (${s.rows})`}`).join(" · ")}</p>
                {preview.warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-700 dark:text-warning">{w}</p>)}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Match each lender in your sheet</p>
                <ul className="divide-y rounded-lg border">
                  {preview.lenders.map((name) => (
                    <li key={name} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 truncate text-sm">{name} <span className="text-xs text-muted-foreground">· {preview.rows.filter((r) => r.lender === name).length} month(s)</span></span>
                      <NativeSelect aria-label={`Lender for ${name}`} className="h-9 sm:max-w-72" value={mapping[name] ?? "new"} onChange={(e) => setMapping((m) => ({ ...m, [name]: e.target.value }))}>
                        <option value="new">Add as a new lender</option>
                        {preview.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        <option value="skip">Don&apos;t import</option>
                      </NativeSelect>
                    </li>
                  ))}
                </ul>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Replace figures I already entered for the same months
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={commit} disabled={busy}>{busy && <Loader2 className="animate-spin" />}Import {preview.rows.filter((r) => mapping[r.lender] !== "skip").length} row(s)</Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UndoExcelButton() {
  const router = useRouter();
  return (
    <ConfirmButton
      variant="ghost"
      className="text-muted-foreground"
      title="Remove the imported Excel history?"
      description="Every figure that came from Excel is removed and those months are calculated again. Figures you typed in yourself and lenders you added stay."
      confirmLabel="Remove import"
      onConfirm={async () => {
        const res = await undoDebtExcelAction();
        if (res.ok) {
          toast.success(`Removed ${res.data} imported row(s).`);
          router.refresh();
        }
        return res.ok ? undefined : res;
      }}
    >
      <RotateCcw /> Undo Excel import
    </ConfirmButton>
  );
}
