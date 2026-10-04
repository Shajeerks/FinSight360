"use client";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteBankAccountAction, deleteCashAccountAction } from "@/features/accounts/actions";
import { deleteCreditCardAction } from "@/features/credit-cards/actions";

const DESC = "It disappears from lists and totals. Existing transactions are kept for your history and reports.";

export function DeleteAccountButton({ id, kind, name }: { id: string; kind: "bank" | "cash" | "card"; name: string }) {
  const action = kind === "bank" ? deleteBankAccountAction : kind === "cash" ? deleteCashAccountAction : deleteCreditCardAction;
  return (
    <ConfirmButton
      title={`Remove ${name}?`}
      description={DESC}
      confirmLabel="Remove"
      className="text-muted-foreground hover:text-destructive"
      aria-label={`Remove ${name}`}
      onConfirm={() => action(id)}
    >
      <Trash2 /> Remove
    </ConfirmButton>
  );
}
