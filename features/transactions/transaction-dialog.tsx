"use client";
import * as React from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { TransactionForm, type TransactionFormDefaults } from "@/features/transactions/transaction-form";
import { deleteTransactionAction, loadTransactionAction } from "@/features/transactions/actions";
import type { TransactionFormOptions } from "@/services/transaction.service";
import { KIND_SPECS, type TransactionKind } from "@/lib/transactions/kinds";

export function AddTransactionButton({
  options,
  kind = "EXPENSE",
  lockKind,
  label,
  defaults,
  variant = "default",
  size = "default",
  className,
}: {
  options: TransactionFormOptions;
  kind?: TransactionKind;
  lockKind?: boolean;
  label?: string;
  defaults?: TransactionFormDefaults;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const text = label ?? `Add ${KIND_SPECS[kind].label}`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Plus /> {text}
      </Button>
      <DialogContent title={text} description="Amounts are stored exactly — no rounding errors.">
        {open && <TransactionForm options={options} defaults={{ ...defaults, kind }} lockKind={lockKind} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function TransactionRowActions({ id, options, label }: { id: string; options: TransactionFormOptions; label: string }) {
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<TransactionFormDefaults | null>(null);
  const [loading, start] = React.useTransition();

  const openEditor = () =>
    start(async () => {
      const res = await loadTransactionAction(id);
      if (!res.ok || !res.data) {
        toast.error(res.ok ? "Could not load this transaction." : res.error);
        return;
      }
      setValues(res.data as TransactionFormDefaults);
      setOpen(true);
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="icon" className="size-9" onClick={openEditor} disabled={loading} aria-label={`Edit ${label}`}>
        {loading ? <Loader2 className="animate-spin" /> : <Pencil />}
      </Button>
      <ConfirmButton
        variant="ghost"
        size="icon"
        className="size-9 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${label}`}
        title="Delete this transaction?"
        description="It will be removed from totals and balances. The audit log keeps a record."
        onConfirm={() => deleteTransactionAction(id)}
      >
        <Trash2 />
      </ConfirmButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Edit transaction">
          {open && values && <TransactionForm options={options} transactionId={id} defaults={values} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
