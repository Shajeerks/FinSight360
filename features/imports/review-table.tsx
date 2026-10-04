"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CopyCheck, Link2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/select-native";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { cancelImportAction, commitImportAction, setAllIncludedAction, updateImportRowAction } from "@/features/imports/actions";

export type ReviewRow = {
  id: string;
  rowNumber: number;
  date: string | null;
  amount: string | null;
  direction: "DEBIT" | "CREDIT" | null;
  description: string | null;
  referenceNumber: string | null;
  status: string;
  include: boolean;
  transactionType: string | null;
  categoryId: string | null;
  subCategoryId: string | null;
  confidence: number | null;
  duplicateScore: number | null;
  matchedFields: string[];
  errorMessage: string | null;
  matched: { date: string; amount: string; description: string; source: string } | null;
};
type Category = { id: string; name: string; kind: string; subCategories: { id: string; name: string }[] };

const TYPE_OPTIONS: Record<"DEBIT" | "CREDIT", [string, string][]> = {
  DEBIT: [["EXPENSE", "Expense"], ["FEE", "Fee / charge"], ["ATM_WITHDRAWAL", "ATM / cash"], ["EMI", "Loan EMI"], ["INVESTMENT", "Investment"], ["CARD_PAYMENT", "Card bill payment"], ["OTHER", "Other (money out)"]],
  CREDIT: [["INCOME", "Income"], ["REFUND", "Refund"], ["REVERSAL", "Reversal"], ["INTEREST", "Interest"], ["CARD_PAYMENT", "Card payment received"], ["OTHER", "Other (money in)"]],
};

const STATUS_BADGE: Record<string, React.ReactNode> = {
  VALID: <Badge variant="success">New</Badge>,
  DUPLICATE: <Badge variant="default"><Link2 /> Already in ledger</Badge>,
  POSSIBLE_DUPLICATE: <Badge variant="warning"><CopyCheck /> Possible duplicate</Badge>,
  SKIPPED: <Badge variant="secondary">Skipped</Badge>,
  INVALID: <Badge variant="destructive">Can&apos;t read</Badge>,
  IMPORTED: <Badge variant="success"><CheckCircle2 /> Imported</Badge>,
};

const FILTERS = [
  ["all", "All"],
  ["VALID", "New"],
  ["DUPLICATE", "In ledger"],
  ["POSSIBLE_DUPLICATE", "Possible duplicates"],
  ["problem", "Skipped / errors"],
] as const;

function categoryKindsFor(type: string | null, direction: string | null) {
  if (type === "CARD_PAYMENT" || type === "TRANSFER") return ["TRANSFER"];
  if (direction === "CREDIT") return type === "REFUND" || type === "REVERSAL" ? ["EXPENSE"] : ["INCOME"];
  return ["EXPENSE"];
}

export function ImportReviewTable({ importId, rows: initialRows, categories, editable }: { importId: string; rows: ReviewRow[]; categories: Category[]; editable: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState(initialRows);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number][0]>("all");
  const [busy, start] = React.useTransition();
  // Re-sync when the server sends fresh rows (after router.refresh()).
  const [prevRows, setPrevRows] = React.useState(initialRows);
  if (prevRows !== initialRows) {
    setPrevRows(initialRows);
    setRows(initialRows);
  }

  const importable = rows.filter((r) => ["VALID", "DUPLICATE", "POSSIBLE_DUPLICATE"].includes(r.status));
  const selected = importable.filter((r) => r.include);
  const counts = {
    newRows: selected.filter((r) => r.status === "VALID").length,
    linked: selected.filter((r) => r.status === "DUPLICATE").length,
    possible: selected.filter((r) => r.status === "POSSIBLE_DUPLICATE").length,
    lowConfidence: selected.filter((r) => r.status === "VALID" && (r.confidence ?? 100) < 80).length,
  };
  const shown = rows.filter((r) =>
    filter === "all" ? r.status !== "SKIPPED" || r.errorMessage?.startsWith("Already") : filter === "problem" ? r.status === "SKIPPED" || r.status === "INVALID" : r.status === filter,
  );

  function patch(row: ReviewRow, change: Partial<Pick<ReviewRow, "include" | "transactionType" | "categoryId" | "subCategoryId">>) {
    const before = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...change } : r)));
    start(async () => {
      const body: Record<string, unknown> = {};
      if (change.include !== undefined) body.include = change.include;
      if (change.transactionType) body.transactionType = change.transactionType;
      if ("categoryId" in change) Object.assign(body, { categoryId: change.categoryId ?? null, subCategoryId: change.subCategoryId ?? null });
      const res = await updateImportRowAction(importId, row.id, body);
      if (!res.ok) {
        setRows(before);
        toast.error(res.error);
      } else if (change.transactionType) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {editable && (
        <Card className="sticky top-16 z-10 border-primary/30 shadow-md">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium">
                {selected.length} of {importable.length} rows will be imported
              </p>
              <p className="text-muted-foreground">
                {counts.newRows} new · {counts.linked} linked to existing · {counts.possible} possible duplicate{counts.possible === 1 ? "" : "s"} to review
                {counts.lowConfidence ? ` · ${counts.lowConfidence} low-confidence` : ""}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  start(async () => {
                    const res = await cancelImportAction(importId);
                    if (res.ok) {
                      toast.success(res.message ?? "Cancelled");
                      router.push("/imports");
                    } else toast.error(res.error);
                  })
                }
              >
                Cancel
              </Button>
              <Button
                disabled={busy || selected.length === 0}
                onClick={() =>
                  start(async () => {
                    const res = await commitImportAction(importId);
                    if (!res.ok) return void toast.error(res.error);
                    const s = res.data!;
                    toast.success(`Imported: ${s.created} new, ${s.linked} linked to existing${s.possibleDuplicates ? `, ${s.possibleDuplicates} to review as duplicates` : ""}${s.pendingReview ? `, ${s.pendingReview} waiting for approval` : ""}.`);
                    router.refresh();
                  })
                }
              >
                {busy ? <Loader2 className="animate-spin" /> : <Upload />} Import {selected.length} row{selected.length === 1 ? "" : "s"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {editable && counts.possible > 0 && (
        <Alert variant="info">
          <AlertTriangle />
          <span>Possible duplicates are imported as <strong>pending</strong> — they don&apos;t count until you decide in Review Duplicates.</span>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter rows">
        {FILTERS.map(([key, label]) => (
          <Button key={key} role="tab" aria-selected={filter === key} size="sm" variant={filter === key ? "secondary" : "ghost"} onClick={() => setFilter(key)}>
            {label}
          </Button>
        ))}
        {editable && (
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await setAllIncludedAction(importId, true); router.refresh(); })}>Select all</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await setAllIncludedAction(importId, false); router.refresh(); })}>Select none</Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No rows here.</p>
          ) : (
            <ul className="divide-y">
              {shown.map((r) => {
                const importableRow = ["VALID", "DUPLICATE", "POSSIBLE_DUPLICATE"].includes(r.status);
                const kinds = categoryKindsFor(r.transactionType, r.direction);
                const cats = categories.filter((c) => kinds.includes(c.kind));
                const cat = cats.find((c) => c.id === r.categoryId);
                return (
                  <li key={r.id} className={cn("grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto]", !r.include && importableRow && editable && "opacity-60")}>
                    <div className="pt-0.5">
                      {editable && importableRow ? (
                        <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={r.include} aria-label={`Import row ${r.rowNumber}`} onChange={(e) => patch(r, { include: e.target.checked })} />
                      ) : (
                        <span className="inline-block w-5 text-xs text-muted-foreground">{r.rowNumber}</span>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {STATUS_BADGE[r.status] ?? <Badge variant="secondary">{r.status}</Badge>}
                        {r.confidence !== null && r.confidence < 80 && importableRow && <Badge variant="warning">Low confidence</Badge>}
                        <span className="text-xs text-muted-foreground">{r.date ?? ""}</span>
                      </div>
                      <p className="break-words text-sm font-medium">{r.description ?? r.errorMessage ?? "—"}</p>
                      {r.errorMessage && r.description && <p className="text-xs text-muted-foreground">{r.errorMessage}</p>}
                      {r.matched && (
                        <p className="text-xs text-muted-foreground">
                          Matches {r.matched.source.toLowerCase()} entry “{r.matched.description}” on {r.matched.date}
                          {r.duplicateScore !== null ? ` · score ${r.duplicateScore}` : ""}
                          {r.matchedFields.length ? ` (${r.matchedFields.join(", ")})` : ""}
                        </p>
                      )}
                      {editable && importableRow && r.status !== "DUPLICATE" && r.direction && (
                        <div className="grid gap-2 pt-1 sm:grid-cols-3">
                          <NativeSelect aria-label="Type" value={r.transactionType ?? ""} onChange={(e) => patch(r, { transactionType: e.target.value })}>
                            {TYPE_OPTIONS[r.direction].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </NativeSelect>
                          <NativeSelect aria-label="Category" value={r.categoryId ?? ""} onChange={(e) => patch(r, { categoryId: e.target.value || null, subCategoryId: null })}>
                            <option value="">Uncategorized</option>
                            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </NativeSelect>
                          {cat && cat.subCategories.length > 0 && (
                            <NativeSelect aria-label="Sub-category" value={r.subCategoryId ?? ""} onChange={(e) => patch(r, { categoryId: r.categoryId, subCategoryId: e.target.value || null })}>
                              <option value="">— sub-category —</option>
                              {cat.subCategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </NativeSelect>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      {r.amount && (
                        <span className={cn("tabular whitespace-nowrap font-semibold", r.direction === "CREDIT" && "text-success")}>
                          {r.direction === "CREDIT" ? "+" : "−"}₹{Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>
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
