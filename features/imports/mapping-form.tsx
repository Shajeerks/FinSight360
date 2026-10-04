"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyMappingAction, cancelImportAction, previewMappingAction } from "@/features/imports/actions";
import { DATE_FORMATS } from "@/lib/import/values";

type Field = "transactionDate" | "description" | "debit" | "credit" | "amount" | "type" | "referenceNumber" | "balance";
type Mode = "DEBIT_CREDIT_COLUMNS" | "SIGNED_AMOUNT" | "AMOUNT_WITH_TYPE_COLUMN";
export type MappingInitial = { headerRowIndex: number; fields: Partial<Record<Field, number>>; dateFormat: string | null; amountMode: Mode | null; positiveIs: "CREDIT" | "DEBIT" };
type PreviewRow = { rowNumber: number; ok: true; date: string; amount: string; direction: "DEBIT" | "CREDIT"; description: string } | { rowNumber: number; ok: false; skip: boolean; error: string };

const FIELD_LABEL: Record<Field, string> = {
  transactionDate: "Date *",
  description: "Description / narration *",
  debit: "Debit / withdrawal",
  credit: "Credit / deposit",
  amount: "Amount",
  type: "Dr / Cr column",
  referenceNumber: "Reference / UTR",
  balance: "Balance",
};
const MODE_LABEL: Record<Mode, string> = {
  DEBIT_CREDIT_COLUMNS: "Separate debit and credit columns",
  SIGNED_AMOUNT: "One amount column (+ / − or Cr/Dr suffix)",
  AMOUNT_WITH_TYPE_COLUMN: "Amount column + a Dr/Cr column",
};

export function MappingForm({ importId, sampleRows, initial, templateName }: { importId: string; sampleRows: { rowNumber: number; cells: string[] }[]; initial: MappingInitial; templateName: string | null }) {
  const router = useRouter();
  const [headerRowIndex, setHeaderRowIndex] = React.useState(initial.headerRowIndex);
  const [fields, setFields] = React.useState(initial.fields);
  const [dateFormat, setDateFormat] = React.useState(initial.dateFormat ?? "dd/MM/yyyy");
  const [amountMode, setAmountMode] = React.useState<Mode>(initial.amountMode ?? "DEBIT_CREDIT_COLUMNS");
  const [positiveIs, setPositiveIs] = React.useState(initial.positiveIs);
  const [saveAs, setSaveAs] = React.useState("");
  const [preview, setPreview] = React.useState<PreviewRow[] | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [busy, start] = React.useTransition();

  const headers = sampleRows.find((r) => r.rowNumber === headerRowIndex)?.cells ?? [];
  const visible: Field[] = ["transactionDate", "description", ...(amountMode === "DEBIT_CREDIT_COLUMNS" ? (["debit", "credit"] as Field[]) : amountMode === "SIGNED_AMOUNT" ? (["amount"] as Field[]) : (["amount", "type"] as Field[])), "referenceNumber", "balance"];
  const payload = React.useMemo(() => {
    const p: Record<string, unknown> = { headerRowIndex, dateFormat, amountMode, positiveIs };
    for (const f of Object.keys(FIELD_LABEL) as Field[]) p[f] = fields[f] ?? null;
    return p;
  }, [headerRowIndex, dateFormat, amountMode, positiveIs, fields]);

  React.useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await previewMappingAction(importId, payload);
      if (cancelled) return;
      setPreview(res.ok ? (res.data ?? null) : null);
      setErrors(res.ok ? {} : (res.fieldErrors ?? {}));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [importId, payload]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await applyMappingAction(importId, { ...payload, saveTemplateName: saveAs || null });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Done");
      router.refresh();
    });
  }

  const okRows = preview?.filter((r) => r.ok).length ?? 0;

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Match the columns</CardTitle>
          <CardDescription>{templateName ? `Pre-filled from your saved "${templateName}" template.` : "We guessed these from the header row — check them."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormField id="map-header" label="Header row">
            <NativeSelect id="map-header" value={headerRowIndex} onChange={(e) => setHeaderRowIndex(Number(e.target.value))}>
              {sampleRows.map((r) => (
                <option key={r.rowNumber} value={r.rowNumber}>
                  Row {r.rowNumber + 1}: {r.cells.filter(Boolean).join(" · ").slice(0, 60)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="map-mode" label="Amounts are in">
            <NativeSelect id="map-mode" value={amountMode} onChange={(e) => setAmountMode(e.target.value as Mode)}>
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </NativeSelect>
          </FormField>
          {visible.map((f) => (
            <FormField key={f} id={`map-${f}`} label={FIELD_LABEL[f]} error={errors[f]?.[0]}>
              <NativeSelect
                id={`map-${f}`}
                value={fields[f] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}
                aria-invalid={Boolean(errors[f])}
              >
                <option value="">— not in this file —</option>
                {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </NativeSelect>
            </FormField>
          ))}
          {amountMode === "SIGNED_AMOUNT" && (
            <FormField id="map-positive" label="A positive amount means">
              <NativeSelect id="map-positive" value={positiveIs} onChange={(e) => setPositiveIs(e.target.value as "CREDIT" | "DEBIT")}>
                <option value="CREDIT">Money in (most bank exports)</option>
                <option value="DEBIT">Money out / spent (most card exports)</option>
              </NativeSelect>
            </FormField>
          )}
          <FormField id="map-date" label="Date format" error={errors.dateFormat?.[0]}>
            <NativeSelect id="map-date" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </NativeSelect>
          </FormField>
          <FormField id="map-save" label="Save as template (optional)" hint="Next time a file with these columns is uploaded, this mapping is applied automatically.">
            <Input id="map-save" placeholder="e.g. HDFC savings CSV" value={saveAs} maxLength={60} onChange={(e) => setSaveAs(e.target.value)} />
          </FormField>
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>{preview ? `${okRows} of the first ${preview.length} rows read correctly.` : "Checking…"}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {preview?.map((r) => (
                <li key={r.rowNumber} className="flex items-start gap-3 px-4 py-2.5">
                  {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className={`mt-0.5 size-4 shrink-0 ${r.skip ? "text-muted-foreground" : "text-destructive"}`} />}
                  {r.ok ? (
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.description}</p>
                        <p className="text-xs text-muted-foreground">{r.date}</p>
                      </div>
                      <span className={`tabular shrink-0 font-semibold ${r.direction === "CREDIT" ? "text-success" : ""}`}>{r.direction === "CREDIT" ? "+" : "−"}₹{r.amount}</span>
                    </div>
                  ) : (
                    <p className={r.skip ? "text-muted-foreground" : "text-destructive"}>Row {r.rowNumber + 1}: {r.error}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const res = await cancelImportAction(importId);
                if (res.ok) router.push("/imports");
                else toast.error(res.error);
              })
            }
          >
            Cancel import
          </Button>
          <Button type="submit" disabled={busy || okRows === 0}>
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />} Continue to review
          </Button>
        </div>
      </div>
    </form>
  );
}
