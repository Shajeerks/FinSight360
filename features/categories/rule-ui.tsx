"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { ruleSchema, type RuleInput } from "@/validators/transactions";
import { applyRulesAction, deleteRuleAction, saveRuleAction, toggleRuleAction } from "@/features/categories/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";

export type CategoryChoice = { id: string; name: string; kind: string; subCategories: { id: string; name: string }[] };

export function RuleDialog({ categories, id = null, defaults, trigger = "add" }: { categories: CategoryChoice[]; id?: string | null; defaults?: Partial<RuleInput>; trigger?: "add" | "edit" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<RuleInput, unknown, z.output<typeof ruleSchema>>({
    resolver: zodResolver(ruleSchema),
    defaultValues: { name: "", matchType: "MERCHANT", pattern: "", amountMin: "", amountMax: "", direction: "", categoryId: "", subCategoryId: "", priority: 50, isActive: true, ...defaults },
  });
  const matchType = useWatch({ control: form.control, name: "matchType" });
  const categoryId = useWatch({ control: form.control, name: "categoryId" });
  const selected = categories.find((c) => c.id === categoryId);
  const { errors } = form.formState;

  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await saveRuleAction(id, form.getValues());
      if (!res.ok) {
        setError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof RuleInput, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "add" ? (
        <Button onClick={() => setOpen(true)}><Plus /> Add rule</Button>
      ) : (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label="Edit rule"><Pencil /></Button>
      )}
      <DialogContent title={id ? "Edit rule" : "Add categorization rule"} description="Rules run on new transactions that don't already have a category.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="matchType" label="Match on">
            <NativeSelect id="matchType" {...form.register("matchType")}>
              <option value="MERCHANT">Merchant name (e.g. SWIGGY)</option>
              <option value="KEYWORD">Keyword in description (e.g. FUEL)</option>
              <option value="AMOUNT">Amount range (optionally + keyword)</option>
            </NativeSelect>
          </FormField>
          <FormField id="pattern" label={matchType === "AMOUNT" ? "Keyword (optional)" : matchType === "MERCHANT" ? "Merchant" : "Keyword"} hint="Case doesn't matter. Whole words are matched." error={errors.pattern?.message}>
            <Input id="pattern" {...form.register("pattern")} />
          </FormField>
          {matchType === "AMOUNT" && (
            <div className="grid grid-cols-2 gap-3">
              <FormField id="amountMin" label="Min ₹" error={errors.amountMin?.message}><Input id="amountMin" inputMode="decimal" {...form.register("amountMin")} /></FormField>
              <FormField id="amountMax" label="Max ₹" error={errors.amountMax?.message}><Input id="amountMax" inputMode="decimal" {...form.register("amountMax")} /></FormField>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="categoryId" label="Category" error={errors.categoryId?.message}>
              <NativeSelect id="categoryId" {...form.register("categoryId", { onChange: () => form.setValue("subCategoryId", "") })}>
                <option value="">Choose…</option>
                <optgroup label="Expense">{categories.filter((c) => c.kind === "EXPENSE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                <optgroup label="Income">{categories.filter((c) => c.kind === "INCOME").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              </NativeSelect>
            </FormField>
            <FormField id="subCategoryId" label="Sub-category">
              <NativeSelect id="subCategoryId" disabled={!selected?.subCategories.length} {...form.register("subCategoryId")}>
                <option value="">None</option>
                {selected?.subCategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="direction" label="Applies to">
              <NativeSelect id="direction" {...form.register("direction")}>
                <option value="">Money in & out</option>
                <option value="DEBIT">Money out only</option>
                <option value="CREDIT">Money in only</option>
              </NativeSelect>
            </FormField>
            <FormField id="priority" label="Priority" hint="Lower runs first" error={errors.priority?.message}>
              <Input id="priority" inputMode="numeric" {...form.register("priority")} />
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save rule</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RuleToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        className="size-5 accent-[var(--primary)]"
        checked={isActive}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const res = await toggleRuleAction(id, e.target.checked);
            if (!res.ok) toast.error(res.error);
            router.refresh();
          })
        }
      />
      {isActive ? "On" : "Off"}
    </label>
  );
}

export function DeleteRuleButton({ id }: { id: string }) {
  return (
    <ConfirmButton variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Delete rule" title="Delete this rule?" description="Already-categorized transactions are not changed." onConfirm={() => deleteRuleAction(id)}>
      <Trash2 />
    </ConfirmButton>
  );
}

export function ApplyRulesButton() {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await applyRulesAction();
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.message ?? "Done");
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Wand2 />} Apply to uncategorized
    </Button>
  );
}
