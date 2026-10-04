type Acct = {
  bankAccount?: { nickname: string; bankName: string; last4: string | null } | null;
  creditCard?: { cardName: string; bankName: string; last4: string } | null;
  cashAccount?: { name: string } | null;
  transactionType?: string;
};

/** Human label of the account(s) a transaction or import belongs to. */
export function accountLabelOf(t: Acct): string {
  const bank = t.bankAccount ? `${t.bankAccount.nickname}${t.bankAccount.last4 ? ` ••${t.bankAccount.last4}` : ""}` : null;
  const card = t.creditCard ? `${t.creditCard.bankName} ${t.creditCard.cardName} ••${t.creditCard.last4}` : null;
  const cash = t.cashAccount ? `${t.cashAccount.name} (cash)` : null;
  if (t.transactionType === "CARD_PAYMENT" && card) return `${bank ?? cash ?? "?"} → ${card}`;
  return card ?? bank ?? cash ?? "—";
}

export const IMPORT_STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  UPLOADED: { label: "Uploaded", variant: "secondary" },
  PARSING: { label: "Reading", variant: "secondary" },
  AWAITING_MAPPING: { label: "Needs column mapping", variant: "warning" },
  AWAITING_REVIEW: { label: "Ready to review", variant: "warning" },
  IMPORTING: { label: "Importing", variant: "secondary" },
  COMPLETED: { label: "Imported", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  CANCELLED: { label: "Cancelled / undone", variant: "secondary" },
};
