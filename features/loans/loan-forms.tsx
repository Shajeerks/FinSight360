"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calculator, History, Loader2, Pencil, Percent, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  loanSchema, loanDetailsSchema, loanPaymentSchema, loanProgressSchema, rateRevisionSchema,
  LOAN_TYPES, INTEREST_TYPES, EMI_FREQUENCIES,
  type LoanInput, type LoanDetailsInput, type LoanPaymentInput, type LoanProgressInput, type RateRevisionInput,
} from "@/validators/loans";
import { createLoanAction, previewEmiAction, recordLoanPaymentAction, reviseRateAction, setLoanProgressAction, updateLoanAction } from "@/features/loans/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/errors";

export const LOAN_TYPE_LABEL: Record<string, string> = { HOME: "Home loan", CAR: "Car loan", PERSONAL: "Personal loan", EDUCATION: "Education loan", OTHER: "Other" };
const FREQ_LABEL: Record<string, string> = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", YEARLY: "Yearly" };
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

type AccountOption = { ref: string; label: string };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function applyErrors(form: { setError: (k: never, e: { message: string }) => void }, res: ActionResult<unknown>) {
  if (!res.ok) for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as never, { message: v[0] });
}

// ───────────────────────── Add loan ─────────────────────────

export function AddLoanDialog({ banks }: { banks: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ emi: string; installments: number; totalInterest: string; totalPayment: string } | null>(null);
  const form = useForm<LoanInput, unknown, z.output<typeof loanSchema>>({
    resolver: zodResolver(loanSchema),
    defaultValues: {
      name: "", lender: "", loanType: "HOME", accountLast4: "", principal: "", interestRate: "", interestType: "FIXED",
      startDate: today(), firstEmiDate: today(), tenureMonths: 60, emiFrequency: "MONTHLY", emiAmount: "", roundEmiToRupee: false,
      repaymentAccountId: banks[0]?.id ?? "", markPastAsPaid: true, emisPaid: "", outstandingAsPerBank: "", notes: "",
    },
  });
  const { errors } = form.formState;
  const [principal, rate, tenure, freq, roundUp] = useWatch({ control: form.control, name: ["principal", "interestRate", "tenureMonths", "emiFrequency", "roundEmiToRupee"] });

  const canPreview = Boolean(open && principal && rate && tenure);
  React.useEffect(() => {
    if (!canPreview) return;
    const h = setTimeout(async () => {
      const res = await previewEmiAction({ principal, interestRate: rate, tenureMonths: tenure, emiFrequency: freq, roundEmiToRupee: roundUp });
      setPreview(res.ok && res.data ? res.data : null);
    }, 350);
    return () => clearTimeout(h);
  }, [canPreview, principal, rate, tenure, freq, roundUp]);

  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await createLoanAction(form.getValues());
      if (!res.ok) return void (setError(res.error), applyErrors(form, res));
      toast.success(res.message ?? "Saved");
      setOpen(false);
      form.reset();
      router.push(`/loans/${res.data!.id}`);
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}><Plus /> Add Loan</Button>
      <DialogContent title="Add Loan" description="FinSight360 builds the full EMI schedule from these terms.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="name" label="Loan name" error={errors.name?.message}><Input id="name" placeholder="e.g. Home loan" {...form.register("name")} /></FormField>
            <FormField id="lender" label="Lender" error={errors.lender?.message}><Input id="lender" placeholder="e.g. SBI" {...form.register("lender")} /></FormField>
            <FormField id="loanType" label="Loan type">
              <NativeSelect id="loanType" {...form.register("loanType")}>{LOAN_TYPES.map((t) => <option key={t} value={t}>{LOAN_TYPE_LABEL[t]}</option>)}</NativeSelect>
            </FormField>
            <FormField id="accountLast4" label="Loan account last 4 (optional)" error={errors.accountLast4?.message}><Input id="accountLast4" inputMode="numeric" maxLength={4} {...form.register("accountLast4")} /></FormField>
            <FormField id="principal" label="Principal (₹)" error={errors.principal?.message}><Input id="principal" inputMode="decimal" {...form.register("principal")} /></FormField>
            <FormField id="interestRate" label="Interest rate (% per year)" error={errors.interestRate?.message}><Input id="interestRate" inputMode="decimal" placeholder="9.5" {...form.register("interestRate")} /></FormField>
            <FormField id="tenureMonths" label="Tenure (months)" error={errors.tenureMonths?.message}><Input id="tenureMonths" inputMode="numeric" {...form.register("tenureMonths")} /></FormField>
            <FormField id="emiFrequency" label="EMI frequency">
              <NativeSelect id="emiFrequency" {...form.register("emiFrequency")}>{EMI_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}</NativeSelect>
            </FormField>
            <FormField id="interestType" label="Interest type">
              <NativeSelect id="interestType" {...form.register("interestType")}>{INTEREST_TYPES.map((t) => <option key={t} value={t}>{t === "FIXED" ? "Fixed" : "Floating"}</option>)}</NativeSelect>
            </FormField>
            <FormField id="repaymentAccountId" label="EMI paid from">
              <NativeSelect id="repaymentAccountId" {...form.register("repaymentAccountId")}>
                <option value="">Not set</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </NativeSelect>
            </FormField>
            <FormField id="startDate" label="Loan start / disbursal date" error={errors.startDate?.message}><Input id="startDate" type="date" {...form.register("startDate")} /></FormField>
            <FormField id="firstEmiDate" label="First EMI date" error={errors.firstEmiDate?.message}><Input id="firstEmiDate" type="date" {...form.register("firstEmiDate")} /></FormField>
          </div>

          <div className="rounded-xl border bg-primary/5 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Calculator className="size-4 text-primary" /> EMI calculator</p>
            {canPreview && preview ? (
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div><p className="text-xs text-muted-foreground">EMI</p><p className="tabular font-semibold">{inr.format(Number(preview.emi))}</p></div>
                <div><p className="text-xs text-muted-foreground">Total interest</p><p className="tabular font-semibold">{inr.format(Number(preview.totalInterest))}</p></div>
                <div><p className="text-xs text-muted-foreground">Total payable</p><p className="tabular font-semibold">{inr.format(Number(preview.totalPayment))}</p></div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Enter principal, rate and tenure to see the EMI.</p>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <FormField id="emiAmount" label="Lender's EMI (optional)" hint="Use if it differs slightly from the calculated EMI." error={errors.emiAmount?.message}>
                <Input id="emiAmount" inputMode="decimal" {...form.register("emiAmount")} />
              </FormField>
              <CheckboxField id="roundEmiToRupee" label="Round EMI up to whole rupees" className="self-end" {...form.register("roundEmiToRupee")} />
            </div>
          </div>

          <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">Already repaying this loan?</legend>
            <FormField id="emisPaid" label="EMIs already paid" hint="Leave blank to mark every EMI due before today as paid; enter 0 if none." error={errors.emisPaid?.message}>
              <Input id="emisPaid" inputMode="numeric" placeholder="e.g. 14" {...form.register("emisPaid")} />
            </FormField>
            <FormField id="outstandingAsPerBank" label="Outstanding as per lender (₹, optional)" hint="From your loan statement or lender app. The principal repaid is matched to it." error={errors.outstandingAsPerBank?.message}>
              <Input id="outstandingAsPerBank" inputMode="decimal" {...form.register("outstandingAsPerBank")} />
            </FormField>
            <p className="text-xs text-muted-foreground sm:col-span-2">These are recorded as paid before FinSight360 — no bank transactions are created. You can change them later with <strong>Update repayment progress</strong>.</p>
          </fieldset>
          <FormField id="notes" label="Notes" error={errors.notes?.message}><Textarea id="notes" rows={2} {...form.register("notes")} /></FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Add Loan</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Record payment ─────────────────────────

export function RecordLoanPaymentDialog({
  loanId,
  accounts,
  defaultAccount,
  emi,
  outstanding,
  nextInstallment,
  initialType = "EMI",
  label,
  variant = "default",
  size = "default",
}: {
  loanId: string;
  accounts: AccountOption[];
  defaultAccount?: string;
  emi: string;
  outstanding: string;
  nextInstallment?: { number: number; dueDate: string; amount: string } | null;
  initialType?: "EMI" | "PREPAYMENT" | "FORECLOSURE" | "CHARGE";
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const amountFor = (t: string) => (t === "EMI" ? (nextInstallment?.amount ?? emi) : t === "FORECLOSURE" ? outstanding : "");
  const form = useForm<LoanPaymentInput, unknown, z.output<typeof loanPaymentSchema>>({
    resolver: zodResolver(loanPaymentSchema),
    defaultValues: { paymentType: initialType, paymentDate: today(), amount: amountFor(initialType), account: defaultAccount ?? accounts[0]?.ref ?? "", recordInLedger: true, prepaymentMode: "REDUCE_TENURE", notes: "" },
  });
  const { errors } = form.formState;
  const [type, record] = useWatch({ control: form.control, name: ["paymentType", "recordInLedger"] });

  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await recordLoanPaymentAction(loanId, form.getValues());
      if (!res.ok) return void (setError(res.error), applyErrors(form, res));
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset({ ...form.getValues(), paymentType: initialType, amount: amountFor(initialType) }); }}>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}><Wallet /> {label ?? "Record EMI payment"}</Button>
      <DialogContent title="Record loan payment" description={nextInstallment ? `Next instalment #${nextInstallment.number} due ${nextInstallment.dueDate}` : undefined}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="paymentType" label="Payment type">
            <NativeSelect id="paymentType" {...form.register("paymentType", { onChange: (e) => form.setValue("amount", amountFor(e.target.value)) })}>
              <option value="EMI">EMI (regular instalment)</option>
              <option value="PREPAYMENT">Prepayment (part-payment of principal)</option>
              <option value="FORECLOSURE">Foreclosure (close the loan)</option>
              <option value="CHARGE">Penalty / charges</option>
            </NativeSelect>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="amount" label="Amount (₹)" error={errors.amount?.message}><Input id="amount" inputMode="decimal" {...form.register("amount")} /></FormField>
            <FormField id="paymentDate" label="Paid on" error={errors.paymentDate?.message}><Input id="paymentDate" type="date" {...form.register("paymentDate")} /></FormField>
          </div>
          {type === "PREPAYMENT" && (
            <FormField id="prepaymentMode" label="After prepayment" hint="Reducing tenure usually saves more interest.">
              <NativeSelect id="prepaymentMode" {...form.register("prepaymentMode")}>
                <option value="REDUCE_TENURE">Keep EMI, finish sooner (reduce tenure)</option>
                <option value="REDUCE_EMI">Keep end date, lower EMI</option>
              </NativeSelect>
            </FormField>
          )}
          {type === "FORECLOSURE" && <Alert variant="info">Outstanding principal is ₹{outstanding}. Anything above it is recorded as foreclosure charges/interest.</Alert>}
          {type === "EMI" && <p className="text-xs text-muted-foreground">Paying less or more than the EMI is fine — the remaining schedule is re-calculated.</p>}
          <CheckboxField id="recordInLedger" label="Also add this payment to my transactions" hint="Debits the account below and counts in your monthly EMI totals." {...form.register("recordInLedger")} />
          {record && (
            <FormField id="account" label="Paid from" error={errors.account?.message}>
              <NativeSelect id="account" {...form.register("account")}>
                {accounts.length === 0 && <option value="">Add a bank account first</option>}
                {accounts.map((a) => <option key={a.ref} value={a.ref}>{a.label}</option>)}
              </NativeSelect>
            </FormField>
          )}
          <FormField id="notes" label="Notes" error={errors.notes?.message}><Input id="notes" {...form.register("notes")} /></FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Record payment</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Rate revision ─────────────────────────

export function ReviseRateDialog({ loanId, currentRate }: { loanId: string; currentRate: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<RateRevisionInput, unknown, z.output<typeof rateRevisionSchema>>({ resolver: zodResolver(rateRevisionSchema), defaultValues: { interestRate: currentRate, mode: "KEEP_EMI" } });
  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await reviseRateAction(loanId, form.getValues());
      if (!res.ok) return void (setError(res.error), applyErrors(form, res));
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Percent /> Revise rate</Button>
      <DialogContent title="Revise interest rate" description="Applies from the next unpaid instalment (e.g. floating-rate change).">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="interestRate" label="New rate (% per year)" error={form.formState.errors.interestRate?.message}><Input id="interestRate" inputMode="decimal" {...form.register("interestRate")} /></FormField>
          <FormField id="mode" label="Adjust by">
            <NativeSelect id="mode" {...form.register("mode")}>
              <option value="KEEP_EMI">Keep EMI — change tenure</option>
              <option value="KEEP_TENURE">Keep tenure — change EMI</option>
            </NativeSelect>
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Apply</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Paid before FinSight360 ─────────────────────────

export function LoanProgressDialog({ loanId, defaults, totalEmis, hasRecordedPayments }: { loanId: string; defaults: LoanProgressInput; totalEmis: number; hasRecordedPayments: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoanProgressInput, unknown, z.output<typeof loanProgressSchema>>({ resolver: zodResolver(loanProgressSchema), defaultValues: defaults });
  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await setLoanProgressAction(loanId, form.getValues());
      if (!res.ok) return void (setError(res.error), applyErrors(form, res));
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset(defaults); }}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><History /> Update repayment progress</Button>
      <DialogContent title="Repayment before FinSight360" description="How much of this loan you'd already repaid before tracking it here. No bank transactions are created.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="p-emis" label="EMIs already paid" hint={`Out of ${totalEmis} on the schedule. Payments you record in FinSight360 are counted separately.`} error={form.formState.errors.emisPaid?.message}>
            <Input id="p-emis" inputMode="numeric" {...form.register("emisPaid")} />
          </FormField>
          <FormField
            id="p-out"
            label="Outstanding as per lender (₹, optional)"
            hint={hasRecordedPayments ? "Not available once payments are recorded here — the outstanding then follows those payments." : "From your loan statement or lender app. Principal repaid is matched to it; anything beyond the schedule shows as a part-prepayment."}
            error={form.formState.errors.outstandingAsPerBank?.message}
          >
            <Input id="p-out" inputMode="decimal" disabled={hasRecordedPayments} {...form.register("outstandingAsPerBank")} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Update</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Edit details ─────────────────────────

export function EditLoanDialog({ loanId, defaults, banks }: { loanId: string; defaults: LoanDetailsInput; banks: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const form = useForm<LoanDetailsInput, unknown, z.output<typeof loanDetailsSchema>>({ resolver: zodResolver(loanDetailsSchema), defaultValues: defaults });
  const submit = form.handleSubmit(() =>
    start(async () => {
      const res = await updateLoanAction(loanId, form.getValues());
      if (!res.ok) return void (toast.error(res.error), applyErrors(form, res));
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit</Button>
      <DialogContent title="Edit loan details" description="To change the amounts, record payments or revise the rate.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="e-name" label="Loan name" error={form.formState.errors.name?.message}><Input id="e-name" {...form.register("name")} /></FormField>
            <FormField id="e-lender" label="Lender" error={form.formState.errors.lender?.message}><Input id="e-lender" {...form.register("lender")} /></FormField>
            <FormField id="e-last4" label="Account last 4" error={form.formState.errors.accountLast4?.message}><Input id="e-last4" maxLength={4} {...form.register("accountLast4")} /></FormField>
            <FormField id="e-type" label="Interest type">
              <NativeSelect id="e-type" {...form.register("interestType")}>{INTEREST_TYPES.map((t) => <option key={t} value={t}>{t === "FIXED" ? "Fixed" : "Floating"}</option>)}</NativeSelect>
            </FormField>
            <FormField id="e-acct" label="EMI paid from">
              <NativeSelect id="e-acct" {...form.register("repaymentAccountId")}>
                <option value="">Not set</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </NativeSelect>
            </FormField>
          </div>
          <FormField id="e-notes" label="Notes"><Textarea id="e-notes" rows={2} {...form.register("notes")} /></FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
