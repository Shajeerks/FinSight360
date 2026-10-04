"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { bankAccountSchema, cashAccountSchema, BANK_ACCOUNT_TYPES, RECORD_STATUSES, type BankAccountInput, type CashAccountInput } from "@/validators/accounts";
import { saveBankAccountAction, saveCashAccountAction } from "@/features/accounts/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/errors";

const TYPE_LABEL: Record<string, string> = { SAVINGS: "Savings", CURRENT: "Current", SALARY: "Salary", OTHER: "Other" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", INACTIVE: "Inactive", CLOSED: "Closed" };

function useSave<T extends Record<string, unknown>>(form: { setError: (k: never, e: { message: string }) => void }, save: (v: T) => Promise<ActionResult>, onDone: () => void) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const submit = (values: T) =>
    start(async () => {
      setError(null);
      const res = await save(values);
      if (!res.ok) {
        setError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as never, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      router.refresh();
      onDone();
    });
  return { pending, error, submit };
}

function BankAccountForm({ id, defaults, onDone }: { id: string | null; defaults?: Partial<BankAccountInput>; onDone: () => void }) {
  const form = useForm<BankAccountInput, unknown, z.output<typeof bankAccountSchema>>({
    resolver: zodResolver(bankAccountSchema),
    defaultValues: { bankName: "", nickname: "", accountType: "SAVINGS", last4: "", currentBalance: "", currency: "INR", status: "ACTIVE", notes: "", ...defaults },
  });
  const { errors } = form.formState;
  const { pending, error, submit } = useSave(form, (v) => saveBankAccountAction(id, v), onDone);
  return (
    <form onSubmit={form.handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="bankName" label="Bank" error={errors.bankName?.message}>
          <Input id="bankName" placeholder="e.g. HDFC Bank" {...form.register("bankName")} />
        </FormField>
        <FormField id="nickname" label="Nickname" error={errors.nickname?.message}>
          <Input id="nickname" placeholder="e.g. Salary account" {...form.register("nickname")} />
        </FormField>
        <FormField id="accountType" label="Account type">
          <NativeSelect id="accountType" {...form.register("accountType")}>
            {BANK_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="last4" label="Last 4 digits" hint="Optional. Never enter the full account number." error={errors.last4?.message}>
          <Input id="last4" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="1234" {...form.register("last4")} />
        </FormField>
        <FormField
          id="currentBalance"
          label="Current balance (₹)"
          hint={id ? "Enter what your bank shows today — FinSight360 reconciles to it." : "The balance today. Future transactions update it automatically."}
          error={errors.currentBalance?.message}
        >
          <Input id="currentBalance" inputMode="decimal" placeholder="0.00" {...form.register("currentBalance")} />
        </FormField>
        <FormField id="status" label="Status">
          <NativeSelect id="status" {...form.register("status")}>
            {RECORD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <FormField id="notes" label="Notes" error={errors.notes?.message}>
        <Textarea id="notes" rows={2} {...form.register("notes")} />
      </FormField>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 text-success" /> FinSight360 never asks for internet-banking passwords.
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{id ? "Save changes" : "Add Bank Account"}</Button>
      </div>
    </form>
  );
}

function CashAccountForm({ id, defaults, onDone }: { id: string | null; defaults?: Partial<CashAccountInput>; onDone: () => void }) {
  const form = useForm<CashAccountInput, unknown, z.output<typeof cashAccountSchema>>({
    resolver: zodResolver(cashAccountSchema),
    defaultValues: { name: "Wallet", currentBalance: "", status: "ACTIVE", notes: "", ...defaults },
  });
  const { errors } = form.formState;
  const { pending, error, submit } = useSave(form, (v) => saveCashAccountAction(id, v), onDone);
  return (
    <form onSubmit={form.handleSubmit(() => submit(form.getValues()))} className="grid gap-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="name" label="Name" error={errors.name?.message}>
          <Input id="name" {...form.register("name")} />
        </FormField>
        <FormField id="currentBalance" label="Cash in hand (₹)" error={errors.currentBalance?.message}>
          <Input id="currentBalance" inputMode="decimal" {...form.register("currentBalance")} />
        </FormField>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{id ? "Save changes" : "Add Cash Wallet"}</Button>
      </div>
    </form>
  );
}

export function BankAccountDialog({ id = null, defaults, trigger = "add" }: { id?: string | null; defaults?: Partial<BankAccountInput>; trigger?: "add" | "edit" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "add" ? (
        <Button onClick={() => setOpen(true)}><Plus /> Add Bank Account</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      )}
      <DialogContent title={id ? "Edit bank account" : "Add Bank Account"} description="Only the last four digits are stored.">
        {open && <BankAccountForm id={id} defaults={defaults} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function CashAccountDialog({ id = null, defaults, trigger = "add" }: { id?: string | null; defaults?: Partial<CashAccountInput>; trigger?: "add" | "edit" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "add" ? (
        <Button variant="outline" onClick={() => setOpen(true)}><Plus /> Add Cash Wallet</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      )}
      <DialogContent title={id ? "Edit cash wallet" : "Add Cash Wallet"}>
        {open && <CashAccountForm id={id} defaults={defaults} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
