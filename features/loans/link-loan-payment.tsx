"use client";
import * as React from "react";
import { Link2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { autoLinkLoanPaymentsAction, linkTransactionToLoanAction } from "@/features/loans/actions";

export type LoanChoice = { id: string; label: string; emi: string; instalments: { id: string; label: string; dueDate: string }[] };
export type TxnForLink = { id: string; date: string; amount: string; description: string };

const TYPES = [
  ["EMI", "EMI (pays the chosen instalment)"],
  ["PREPAYMENT", "Prepayment (extra principal)"],
  ["FORECLOSURE", "Foreclosure (closes the loan)"],
  ["CHARGE", "Charges / late fee"],
] as const;

/** Nearest unpaid instalment to the payment date. */
function nearest(loan: LoanChoice | undefined, date: string) {
  if (!loan?.instalments.length) return "";
  const t = new Date(date).getTime();
  return [...loan.instalments].sort((a, b) => Math.abs(new Date(a.dueDate).getTime() - t) - Math.abs(new Date(b.dueDate).getTime() - t))[0].id;
}

function LinkForm({ txn, loans, defaultLoanId, defaultScheduleId, onDone }: { txn: TxnForLink; loans: LoanChoice[]; defaultLoanId?: string; defaultScheduleId?: string | null; onDone?: () => void }) {
  const [loanId, setLoanId] = React.useState(defaultLoanId ?? loans[0]?.id ?? "");
  const loan = loans.find((l) => l.id === loanId);
  const [scheduleId, setScheduleId] = React.useState(defaultScheduleId ?? nearest(loan, txn.date));
  const [type, setType] = React.useState<string>("EMI");
  const [pending, start] = React.useTransition();
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await linkTransactionToLoanAction({ transactionId: txn.id, loanId, scheduleId: type === "EMI" ? scheduleId : null, paymentType: type });
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.message ?? "Linked");
          onDone?.();
        });
      }}
    >
      <FormField id={`ll-loan-${txn.id}`} label="Loan">
        <NativeSelect
          id={`ll-loan-${txn.id}`}
          value={loanId}
          onChange={(e) => {
            setLoanId(e.target.value);
            setScheduleId(nearest(loans.find((l) => l.id === e.target.value), txn.date));
          }}
        >
          {loans.map((l) => <option key={l.id} value={l.id}>{l.label} · EMI ₹{Number(l.emi).toLocaleString("en-IN")}</option>)}
        </NativeSelect>
      </FormField>
      <FormField id={`ll-type-${txn.id}`} label="This payment is">
        <NativeSelect id={`ll-type-${txn.id}`} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </NativeSelect>
      </FormField>
      {type === "EMI" && (
        <FormField id={`ll-emi-${txn.id}`} label="Instalment" hint="The instalment closest to the payment date is chosen for you.">
          <NativeSelect id={`ll-emi-${txn.id}`} value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
            {loan?.instalments.length ? loan.instalments.map((r) => <option key={r.id} value={r.id}>{r.label}</option>) : <option value="">No unpaid instalments</option>}
          </NativeSelect>
        </FormField>
      )}
      <p className="text-xs text-muted-foreground">The bank transaction itself is used (same date and amount), so nothing is added twice and your bank balance doesn&apos;t change. Undo it any time from the loan&apos;s payments list.</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !loanId || (type === "EMI" && !scheduleId)}>
          {pending ? <Loader2 className="animate-spin" /> : <Link2 />} Link payment
        </Button>
      </div>
    </form>
  );
}

/** "Link to loan" on a transaction row. */
export function LinkToLoanButton({ txn, loans, compact }: { txn: TxnForLink; loans: LoanChoice[]; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  if (!loans.length) return null;
  return (
    <>
      <Button variant="ghost" size={compact ? "icon" : "sm"} className={compact ? "size-9" : ""} onClick={() => setOpen(true)} aria-label={`Link ${txn.description} to a loan`} title="Link to a loan EMI">
        <Link2 /> {!compact && "Link to loan"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Link this payment to a loan" description={`${txn.date} · ₹${Number(txn.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })} · ${txn.description.slice(0, 90)}`}>
          {open && <LinkForm txn={txn} loans={loans} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export type CandidateView = TxnForLink & { account: string | null; loanId: string; loanLabel: string; confident: boolean; reasons: string[]; scheduleId: string | null };

/** Bank payments that look like EMIs, each with its best-matching loan. */
export function LoanPaymentSuggestions({ items, loans }: { items: CandidateView[]; loans: LoanChoice[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const sure = items.filter((i) => i.confident).length;
  const quickLink = (c: CandidateView) => {
    setBusy(c.id);
    start(async () => {
      const res = await linkTransactionToLoanAction({ transactionId: c.id, loanId: c.loanId, scheduleId: c.scheduleId, paymentType: "EMI" });
      setBusy(null);
      if (res.ok) toast.success(res.message ?? "Linked");
      else toast.error(res.error);
    });
  };
  return (
    <div className="space-y-3">
      {sure > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p><Sparkles className="mr-1 inline size-4 text-primary" /> {sure} payment(s) clearly match a loan (same EMI amount and the lender&apos;s name or auto-debit).</p>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await autoLinkLoanPaymentsAction();
                if (!res.ok) return void toast.error(res.error);
                toast.success(`Linked ${res.data!.linked} payment(s) to their loans.`);
              })
            }
          >
            {pending && !busy ? <Loader2 className="animate-spin" /> : <Link2 />} Link all clear matches
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-xl border">
        {items.map((c) => (
          <li key={c.id} className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="min-w-0 space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular font-semibold">₹{Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
                <span className="text-muted-foreground">{c.date}{c.account ? ` · ${c.account}` : ""}</span>
                {c.confident ? <Badge variant="success">Clear match</Badge> : <Badge variant="secondary">Possible</Badge>}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={c.description}>{c.description}</p>
              <p className="text-xs">→ <span className="font-medium">{c.loanLabel}</span> <span className="text-muted-foreground">({c.reasons.join(", ")})</span></p>
            </div>
            <div className="flex gap-1">
              <Button size="sm" disabled={busy === c.id} onClick={() => quickLink(c)}>
                {busy === c.id ? <Loader2 className="animate-spin" /> : <Link2 />} Link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>Change…</Button>
            </div>
            <Dialog open={openId === c.id} onOpenChange={(o) => setOpenId(o ? c.id : null)}>
              <DialogContent title="Link this payment to a loan" description={`${c.date} · ₹${Number(c.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })} · ${c.description.slice(0, 90)}`}>
                {openId === c.id && <LinkForm txn={c} loans={loans} defaultLoanId={c.loanId} defaultScheduleId={c.scheduleId} onDone={() => setOpenId(null)} />}
              </DialogContent>
            </Dialog>
          </li>
        ))}
      </ul>
    </div>
  );
}
