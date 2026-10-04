"use client";
import { useRouter } from "next/navigation";
import { Trash2, Undo2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteLoanAction, deleteLoanPaymentAction } from "@/features/loans/actions";

export function DeleteLoanButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      className="text-muted-foreground hover:text-destructive"
      title={`Remove ${name}?`}
      description="The loan and its schedule are hidden. Payments already added to your transactions are kept."
      confirmLabel="Remove"
      onConfirm={async () => {
        const res = await deleteLoanAction(id);
        if (res.ok) router.push("/loans");
        return res;
      }}
    >
      <Trash2 /> Remove
    </ConfirmButton>
  );
}

export function DeleteLoanPaymentButton({ loanId, paymentId }: { loanId: string; paymentId: string }) {
  return (
    <ConfirmButton
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-destructive"
      aria-label="Undo payment"
      title="Undo this payment?"
      description="It's removed from the loan and from your transactions; the remaining schedule is re-calculated."
      confirmLabel="Undo payment"
      onConfirm={() => deleteLoanPaymentAction(loanId, paymentId)}
    >
      <Undo2 />
    </ConfirmButton>
  );
}

