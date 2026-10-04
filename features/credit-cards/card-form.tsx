"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { creditCardSchema, CARD_NETWORKS, CARD_STATUSES, type CreditCardInput } from "@/validators/credit-cards";
import { saveCreditCardAction } from "@/features/credit-cards/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const NETWORK: Record<string, string> = { VISA: "Visa", MASTERCARD: "Mastercard", RUPAY: "RuPay", AMEX: "American Express", DINERS: "Diners Club", OTHER: "Other" };
const STATUS: Record<string, string> = { ACTIVE: "Active", BLOCKED: "Blocked", CLOSED: "Closed" };

function CardForm({ id, defaults, onDone }: { id: string | null; defaults?: Partial<CreditCardInput>; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CreditCardInput, unknown, z.output<typeof creditCardSchema>>({
    resolver: zodResolver(creditCardSchema),
    defaultValues: {
      bankName: "", cardName: "", network: "VISA", last4: "", creditLimit: "", statementDay: "", paymentDueDay: "",
      currentOutstanding: "0", totalAmountDue: "0", minimumAmountDue: "0", currentDueDate: "", annualFee: "0", rewardPoints: 0, status: "ACTIVE", notes: "",
      ...defaults,
    },
  });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await saveCreditCardAction(id, form.getValues());
      if (!res.ok) {
        setError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof CreditCardInput, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      router.refresh();
      onDone();
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error && <Alert variant="destructive">{error}</Alert>}
      <Alert variant="info">
        <ShieldAlert />
        <span>Never enter your full card number, CVV, PIN or OTP. FinSight360 only needs the <strong>last 4 digits</strong>.</span>
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="bankName" label="Bank" error={errors.bankName?.message}>
          <Input id="bankName" placeholder="e.g. HDFC" {...form.register("bankName")} />
        </FormField>
        <FormField id="cardName" label="Card name" error={errors.cardName?.message}>
          <Input id="cardName" placeholder="e.g. Regalia Gold" {...form.register("cardName")} />
        </FormField>
        <FormField id="last4" label="Last 4 digits" error={errors.last4?.message}>
          <Input id="last4" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="1234" {...form.register("last4")} />
        </FormField>
        <FormField id="network" label="Network">
          <NativeSelect id="network" {...form.register("network")}>
            {CARD_NETWORKS.map((n) => <option key={n} value={n}>{NETWORK[n]}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="creditLimit" label="Credit limit (₹)" error={errors.creditLimit?.message}>
          <Input id="creditLimit" inputMode="decimal" {...form.register("creditLimit")} />
        </FormField>
        <FormField id="currentOutstanding" label="Current outstanding (₹)" hint="Total used right now, as shown in your card app." error={errors.currentOutstanding?.message}>
          <Input id="currentOutstanding" inputMode="decimal" {...form.register("currentOutstanding")} />
        </FormField>
        <FormField id="statementDay" label="Statement day" hint="Day of month (1–31)" error={errors.statementDay?.message}>
          <Input id="statementDay" inputMode="numeric" {...form.register("statementDay")} />
        </FormField>
        <FormField id="paymentDueDay" label="Payment due day" hint="Day of month (1–31)" error={errors.paymentDueDay?.message}>
          <Input id="paymentDueDay" inputMode="numeric" {...form.register("paymentDueDay")} />
        </FormField>
      </div>

      <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
        <legend className="px-1 text-sm font-medium">Latest statement</legend>
        <FormField id="totalAmountDue" label="Total due (₹)" error={errors.totalAmountDue?.message}>
          <Input id="totalAmountDue" inputMode="decimal" {...form.register("totalAmountDue")} />
        </FormField>
        <FormField id="minimumAmountDue" label="Minimum due (₹)" error={errors.minimumAmountDue?.message}>
          <Input id="minimumAmountDue" inputMode="decimal" {...form.register("minimumAmountDue")} />
        </FormField>
        <FormField id="currentDueDate" label="Due date" error={errors.currentDueDate?.message}>
          <Input id="currentDueDate" type="date" {...form.register("currentDueDate")} />
        </FormField>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="annualFee" label="Annual fee (₹)" error={errors.annualFee?.message}>
          <Input id="annualFee" inputMode="decimal" {...form.register("annualFee")} />
        </FormField>
        <FormField id="rewardPoints" label="Reward points" error={errors.rewardPoints?.message}>
          <Input id="rewardPoints" inputMode="numeric" {...form.register("rewardPoints")} />
        </FormField>
        <FormField id="status" label="Status">
          <NativeSelect id="status" {...form.register("status")}>
            {CARD_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
          </NativeSelect>
        </FormField>
      </div>
      <FormField id="notes" label="Notes" error={errors.notes?.message}>
        <Textarea id="notes" rows={2} {...form.register("notes")} />
      </FormField>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{id ? "Save changes" : "Add Credit Card"}</Button>
      </div>
    </form>
  );
}

export function CreditCardDialog({ id = null, defaults, trigger = "add" }: { id?: string | null; defaults?: Partial<CreditCardInput>; trigger?: "add" | "edit" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "add" ? (
        <Button onClick={() => setOpen(true)}><Plus /> Add Credit Card</Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      )}
      <DialogContent title={id ? "Edit credit card" : "Add Credit Card"}>
        {open && <CardForm id={id} defaults={defaults} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
