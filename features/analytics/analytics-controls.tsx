"use client";
import * as React from "react";
import { Check, Loader2, Pause, Pencil, Plus, ScanSearch, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteBudgetAction, detectRecurringAction, saveBudgetAction, updateRecurringAction } from "@/features/analytics/actions";

type Cat = { id: string; name: string; subCategories: { id: string; name: string }[] };
type BudgetValues = { id?: string; categoryId: string; subCategoryId: string; period: string; amount: string; alertThresholdPct: string };

export function BudgetDialog({ categories, budget, trigger }: { categories: Cat[]; budget?: BudgetValues; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState<BudgetValues>(budget ?? { categoryId: "", subCategoryId: "", period: "MONTHLY", amount: "", alertThresholdPct: "80" });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const cat = categories.find((c) => c.id === v.categoryId);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus /> Add budget</Button>}
      <DialogContent title={budget ? "Edit budget" : "Add budget"} description="A spending limit for a category (or for all spending). Refunds count against what you spent.">
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await saveBudgetAction(budget?.id ?? null, { ...v, categoryId: v.categoryId || null, subCategoryId: v.subCategoryId || null });
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                setError(res.fieldErrors ? null : res.error);
                return;
              }
              toast.success(res.message ?? "Saved");
              setOpen(false);
            });
          }}
        >
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="b-cat" label="Category" error={errors.categoryId?.[0]}>
              <NativeSelect id="b-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value, subCategoryId: "" })}>
                <option value="">All spending</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="b-sub" label="Sub-category (optional)">
              <NativeSelect id="b-sub" value={v.subCategoryId} disabled={!cat?.subCategories.length} onChange={(e) => setV({ ...v, subCategoryId: e.target.value })}>
                <option value="">Whole category</option>
                {cat?.subCategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="b-amt" label="Limit (₹)" error={errors.amount?.[0]}><Input id="b-amt" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></FormField>
            <FormField id="b-per" label="Period">
              <NativeSelect id="b-per" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}><option value="MONTHLY">Every month</option><option value="YEARLY">Every year</option></NativeSelect>
            </FormField>
            <FormField id="b-alert" label="Warn me at (% used)" error={errors.alertThresholdPct?.[0]}><Input id="b-alert" inputMode="numeric" value={v.alertThresholdPct} onChange={(e) => setV({ ...v, alertThresholdPct: e.target.value })} /></FormField>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{budget ? "Save" : "Add budget"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetRowActions({ categories, budget }: { categories: Cat[]; budget: BudgetValues & { id: string; name: string } }) {
  return (
    <div className="flex gap-1">
      <BudgetDialog categories={categories} budget={budget} trigger={<Button size="icon" variant="ghost" className="size-8" aria-label={`Edit ${budget.name}`}><Pencil /></Button>} />
      <ConfirmButton size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label={`Remove ${budget.name}`} title={`Remove the ${budget.name} budget?`} description="Your transactions aren't affected." confirmLabel="Remove" onConfirm={() => deleteBudgetAction(budget.id)}>
        <Trash2 />
      </ConfirmButton>
    </div>
  );
}

export function RecurringActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = React.useTransition();
  const act = (s: string) =>
    start(async () => {
      const res = await updateRecurringAction(id, { status: s });
      if (res.ok) toast.success(s === "CONFIRMED" ? "Added to your recurring commitments." : s === "DISMISSED" ? "Won't be suggested again." : "Paused.");
      else toast.error(res.error);
    });
  return (
    <div className="flex shrink-0 gap-1">
      {status !== "CONFIRMED" && <Button size="icon" variant="ghost" className="size-8 text-success" aria-label="Confirm" disabled={pending} onClick={() => act("CONFIRMED")}><Check /></Button>}
      {status === "CONFIRMED" && <Button size="icon" variant="ghost" className="size-8" aria-label="Pause" disabled={pending} onClick={() => act("PAUSED")}><Pause /></Button>}
      <Button size="icon" variant="ghost" className="size-8 text-muted-foreground" aria-label="Not recurring" disabled={pending} onClick={() => act("DISMISSED")}><X /></Button>
    </div>
  );
}

export function DetectRecurringButton() {
  const [pending, start] = React.useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const res = await detectRecurringAction();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data!.created ? `Found ${res.data!.created} new recurring payment(s) — confirm the ones that are right.` : "No new recurring payments found.");
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Find recurring
    </Button>
  );
}
