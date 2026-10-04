"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { transactionSchema, INCOME_CATEGORIES, PAYMENT_METHODS, type TransactionInput, type TransactionData } from "@/validators/transactions";
import {
  KIND_SPECS,
  TRANSACTION_KINDS,
  categoryKindsForKind,
  INCOME_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  parseAccountRef,
  type TransactionKind,
} from "@/lib/transactions/kinds";
import { saveTransactionAction } from "@/features/transactions/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Alert } from "@/components/ui/alert";
import type { TransactionFormOptions } from "@/services/transaction.service";
import { cn } from "@/lib/utils";

export type TransactionFormDefaults = Partial<Record<keyof TransactionInput, unknown>> & { kind?: TransactionKind };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const KIND_GROUPS: { label: string; kinds: TransactionKind[] }[] = [
  { label: "Common", kinds: ["EXPENSE", "INCOME", "TRANSFER", "CARD_PAYMENT"] },
  { label: "Other", kinds: ["EMI", "INVESTMENT", "REFUND", "INTEREST", "FEE", "ATM_WITHDRAWAL", "REVERSAL", "OTHER_DEBIT", "OTHER_CREDIT"] },
];

export function TransactionForm({
  options,
  transactionId,
  defaults,
  lockKind,
  onDone,
}: {
  options: TransactionFormOptions;
  transactionId?: string | null;
  defaults?: TransactionFormDefaults;
  /** Hide the kind picker (e.g. "Add Income" page). */
  lockKind?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [showMore, setShowMore] = React.useState(Boolean(defaults?.notes || defaults?.referenceNumber));

  const firstAccount = (kind: TransactionKind) => options.accounts.find((a) => KIND_SPECS[kind].accounts.includes(a.kind))?.ref ?? "";
  const initialKind = (defaults?.kind ?? "EXPENSE") as TransactionKind;

  const form = useForm<TransactionInput, unknown, TransactionData>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      kind: initialKind,
      transactionDate: today(),
      amount: "",
      account: firstAccount(initialKind),
      toAccount: "",
      creditCardId: options.cards[0]?.id ?? "",
      description: "",
      merchantName: "",
      categoryId: "",
      subCategoryId: "",
      referenceNumber: "",
      notes: "",
      paymentMethod: null,
      incomeCategory: initialKind === "INCOME" ? "SALARY" : null,
      sourceName: "",
      isRecurring: false,
      applyToMerchant: false,
      ...(defaults as Partial<TransactionInput>),
    },
  });
  const { errors } = form.formState;
  const kind = (useWatch({ control: form.control, name: "kind" }) ?? "EXPENSE") as TransactionKind;
  const account = useWatch({ control: form.control, name: "account" });
  const categoryId = useWatch({ control: form.control, name: "categoryId" });
  const spec = KIND_SPECS[kind];

  const accountChoices = options.accounts.filter((a) => spec.accounts.includes(a.kind));
  const transferTargets = options.accounts.filter((a) => a.kind !== "card" && a.ref !== account);
  const catKinds = categoryKindsForKind(kind);
  const categoryChoices = options.categories.filter((c) => catKinds.includes(c.kind as "EXPENSE" | "INCOME" | "TRANSFER"));
  const selectedCategory = options.categories.find((c) => c.id === categoryId);
  const showCategory = kind !== "TRANSFER" && kind !== "CARD_PAYMENT";
  const showMerchant = ["EXPENSE", "REFUND", "REVERSAL", "FEE", "OTHER_DEBIT", "EMI", "INVESTMENT"].includes(kind);
  const isIncome = kind === "INCOME";
  const isExpense = ["EXPENSE", "FEE", "ATM_WITHDRAWAL", "OTHER_DEBIT"].includes(kind);

  // Keep the account valid when the kind changes.
  React.useEffect(() => {
    const ref = parseAccountRef(form.getValues("account"));
    if (!ref || !spec.accounts.includes(ref.kind)) form.setValue("account", firstAccount(kind));
    if (kind === "INCOME" && !form.getValues("incomeCategory")) form.setValue("incomeCategory", "SALARY");
    const cat = options.categories.find((c) => c.id === form.getValues("categoryId"));
    if (cat && !catKinds.includes(cat.kind as "EXPENSE")) {
      form.setValue("categoryId", "");
      form.setValue("subCategoryId", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const onSubmit = form.handleSubmit(() => {
    setServerError(null);
    // Send the raw (string) values; the server validates and converts them again.
    const values = form.getValues();
    start(async () => {
      const res = await saveTransactionAction(transactionId ?? null, values);
      if (!res.ok) {
        setServerError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof TransactionInput, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      router.refresh();
      onDone?.();
    });
  });

  if (!options.accounts.length) {
    return <Alert variant="info">Add a bank account, credit card or cash wallet first — every transaction belongs to one.</Alert>;
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {serverError && <Alert variant="destructive">{serverError}</Alert>}

      {!lockKind && (
        <FormField id="kind" label="Type" hint={spec.help}>
          <NativeSelect id="kind" {...form.register("kind")}>
            {KIND_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.kinds.map((k) => (
                  <option key={k} value={k}>{KIND_SPECS[k].label}</option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField id="amount" label="Amount (₹)" error={errors.amount?.message}>
          <Input id="amount" inputMode="decimal" placeholder="0.00" autoComplete="off" aria-invalid={!!errors.amount} {...form.register("amount")} />
        </FormField>
        <FormField id="transactionDate" label="Date" error={errors.transactionDate?.message}>
          <Input id="transactionDate" type="date" aria-invalid={!!errors.transactionDate} {...form.register("transactionDate")} />
        </FormField>
      </div>

      <FormField
        id="account"
        label={kind === "TRANSFER" ? "From account" : kind === "CARD_PAYMENT" ? "Paid from" : spec.direction === "CREDIT" ? "Received in" : "Paid from"}
        error={errors.account?.message}
      >
        <NativeSelect id="account" aria-invalid={!!errors.account} {...form.register("account")}>
          {accountChoices.length === 0 && <option value="">No suitable account</option>}
          {accountChoices.map((a) => (
            <option key={a.ref} value={a.ref}>{a.label}</option>
          ))}
        </NativeSelect>
      </FormField>

      {kind === "TRANSFER" && (
        <FormField id="toAccount" label="To account" error={errors.toAccount?.message}>
          <NativeSelect id="toAccount" aria-invalid={!!errors.toAccount} {...form.register("toAccount")}>
            <option value="">Choose…</option>
            {transferTargets.map((a) => (
              <option key={a.ref} value={a.ref}>{a.label}</option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      {kind === "CARD_PAYMENT" && (
        <FormField id="creditCardId" label="Card being paid" error={errors.creditCardId?.message}>
          <NativeSelect id="creditCardId" aria-invalid={!!errors.creditCardId} {...form.register("creditCardId")}>
            <option value="">Choose…</option>
            {options.cards.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      <FormField id="description" label="Description" error={errors.description?.message}>
        <Input id="description" placeholder={isIncome ? "e.g. October salary" : "e.g. Dinner with family"} aria-invalid={!!errors.description} {...form.register("description")} />
      </FormField>

      {showMerchant && (
        <FormField id="merchantName" label="Merchant" hint="Optional. Used for automatic categorization (e.g. Swiggy, Amazon)." error={errors.merchantName?.message}>
          <Input id="merchantName" autoComplete="off" {...form.register("merchantName")} />
        </FormField>
      )}

      {isIncome && (
        <div className="grid grid-cols-2 gap-3">
          <FormField id="incomeCategory" label="Income type">
            <NativeSelect id="incomeCategory" {...form.register("incomeCategory")}>
              {INCOME_CATEGORIES.map((c) => (
                <option key={c} value={c}>{INCOME_CATEGORY_LABELS[c]}</option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="sourceName" label="Source / payer" error={errors.sourceName?.message}>
            <Input id="sourceName" placeholder="e.g. Employer" {...form.register("sourceName")} />
          </FormField>
        </div>
      )}

      {showCategory && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="categoryId" label="Category" error={errors.categoryId?.message}>
            <NativeSelect
              id="categoryId"
              {...form.register("categoryId", { onChange: () => form.setValue("subCategoryId", "") })}
            >
              <option value="">Auto (apply my rules)</option>
              {categoryChoices.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="subCategoryId" label="Sub-category" error={errors.subCategoryId?.message}>
            <NativeSelect id="subCategoryId" disabled={!selectedCategory?.subCategories.length} {...form.register("subCategoryId")}>
              <option value="">{selectedCategory?.subCategories.length ? "None" : "—"}</option>
              {selectedCategory?.subCategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
      )}

      {isExpense && (
        <FormField id="paymentMethod" label="Payment method" hint="Leave as automatic to infer it from the account.">
          <NativeSelect id="paymentMethod" {...form.register("paymentMethod", { setValueAs: (v) => (v ? v : null) })}>
            <option value="">Automatic</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      {(isIncome || isExpense) && (
        <CheckboxField id="isRecurring" label="This repeats regularly" hint="e.g. salary, rent, subscriptions" {...form.register("isRecurring")} />
      )}

      {showCategory && showMerchant && categoryId && (
        <CheckboxField
          id="applyToMerchant"
          label="Apply this category to future transactions from this merchant"
          hint="Creates or updates a merchant rule you can edit in Settings → Transaction Rules."
          {...form.register("applyToMerchant")}
        />
      )}

      <button type="button" onClick={() => setShowMore((v) => !v)} className="flex items-center gap-1 justify-self-start text-sm font-medium text-primary">
        <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} />
        {showMore ? "Fewer details" : "More details (reference, notes)"}
      </button>
      {showMore && (
        <div className="grid gap-3">
          <FormField id="referenceNumber" label="Reference / UTR number" hint="Optional — helps match duplicates from statements later." error={errors.referenceNumber?.message}>
            <Input id="referenceNumber" autoComplete="off" {...form.register("referenceNumber")} />
          </FormField>
          <FormField id="notes" label="Notes" error={errors.notes?.message}>
            <Textarea id="notes" rows={3} {...form.register("notes")} />
          </FormField>
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 -mb-4 flex flex-col-reverse gap-2 border-t bg-card px-5 py-3 sm:flex-row sm:justify-end">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {transactionId ? "Save changes" : `Add ${spec.label.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}

export const ALL_KINDS = TRANSACTION_KINDS;
