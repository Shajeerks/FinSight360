"use client";
import { useRouter } from "next/navigation";
import { Undo2, X } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { cancelImportAction, undoImportAction } from "@/features/imports/actions";

export function UndoImportButton({ id, size = "sm" }: { id: string; size?: "sm" | "icon" }) {
  return (
    <ConfirmButton
      variant="ghost"
      size={size}
      className="text-muted-foreground hover:text-destructive"
      aria-label="Undo import"
      title="Undo this import?"
      description="Transactions it added are removed and links it made to existing transactions are detached. Balances are recalculated. You can import the file again later."
      confirmLabel="Undo import"
      onConfirm={() => undoImportAction(id)}
    >
      <Undo2 /> {size === "sm" && "Undo"}
    </ConfirmButton>
  );
}

export function CancelImportButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      variant="ghost"
      className="text-muted-foreground"
      title="Cancel this import?"
      description="Nothing from this file has been added yet."
      confirmLabel="Cancel import"
      onConfirm={async () => {
        const res = await cancelImportAction(id);
        if (res.ok) router.refresh();
        return res;
      }}
    >
      <X /> Cancel
    </ConfirmButton>
  );
}
