/**
 * User-facing "kinds" of transaction and how each maps onto the ledger's
 * (transactionType, direction) pair. Keeps forms simple: the user picks
 * "Expense" or "Refund" and never has to think about debit/credit.
 */
export const TRANSACTION_KINDS = [
  "EXPENSE",
  "INCOME",
  "TRANSFER",
  "CARD_PAYMENT",
  "EMI",
  "INVESTMENT",
  "REFUND",
  "INTEREST",
  "FEE",
  "ATM_WITHDRAWAL",
  "REVERSAL",
  "BORROWED",
  "LENT",
  "OTHER_DEBIT",
  "OTHER_CREDIT",
] as const;

export type TransactionKind = (typeof TRANSACTION_KINDS)[number];
export type LedgerType =
  | "INCOME" | "EXPENSE" | "TRANSFER" | "CARD_PAYMENT" | "EMI" | "INVESTMENT"
  | "REFUND" | "REVERSAL" | "INTEREST" | "FEE" | "ATM_WITHDRAWAL" | "BORROWING" | "OTHER";
export type Direction = "DEBIT" | "CREDIT";

type KindSpec = {
  label: string;
  type: LedgerType;
  direction: Direction;
  /** Which account types may be used as the account for this kind. */
  accounts: ("bank" | "card" | "cash")[];
  help: string;
};

export const KIND_SPECS: Record<TransactionKind, KindSpec> = {
  EXPENSE: { label: "Expense", type: "EXPENSE", direction: "DEBIT", accounts: ["bank", "card", "cash"], help: "Money spent on goods or services." },
  INCOME: { label: "Income", type: "INCOME", direction: "CREDIT", accounts: ["bank", "cash"], help: "Salary, freelance, rent received…" },
  TRANSFER: { label: "Transfer between my accounts", type: "TRANSFER", direction: "DEBIT", accounts: ["bank", "cash"], help: "Moves money; not income or expense." },
  CARD_PAYMENT: { label: "Credit-card bill payment", type: "CARD_PAYMENT", direction: "DEBIT", accounts: ["bank", "cash"], help: "Pays a card bill; reduces the card's outstanding. Not an expense." },
  EMI: { label: "Loan EMI", type: "EMI", direction: "DEBIT", accounts: ["bank", "cash"], help: "Loan instalment." },
  INVESTMENT: { label: "Investment / SIP", type: "INVESTMENT", direction: "DEBIT", accounts: ["bank", "cash"], help: "Money invested; tracked separately from expenses." },
  REFUND: { label: "Refund", type: "REFUND", direction: "CREDIT", accounts: ["bank", "card", "cash"], help: "Money returned for an earlier purchase; reduces expenses." },
  INTEREST: { label: "Interest received", type: "INTEREST", direction: "CREDIT", accounts: ["bank"], help: "Savings / FD interest." },
  FEE: { label: "Fee or charge", type: "FEE", direction: "DEBIT", accounts: ["bank", "card", "cash"], help: "Bank charges, card fees, late fees." },
  ATM_WITHDRAWAL: { label: "ATM / cash withdrawal", type: "ATM_WITHDRAWAL", direction: "DEBIT", accounts: ["bank", "card"], help: "Cash taken out (counted as spending)." },
  REVERSAL: { label: "Reversal", type: "REVERSAL", direction: "CREDIT", accounts: ["bank", "card", "cash"], help: "A failed or reversed charge credited back." },
  BORROWED: { label: "Loan / borrowing received (not income)", type: "BORROWING", direction: "CREDIT", accounts: ["bank", "cash"], help: "Loan disbursal, money borrowed from someone, money you lent coming back, or cash / transfer taken from a credit card. Updates the balance but is never counted as income." },
  LENT: { label: "Lent / borrowing repaid (not expense)", type: "BORROWING", direction: "DEBIT", accounts: ["bank", "cash"], help: "Money you lend to someone or pay back to a person you borrowed from. Updates the balance but is never counted as an expense. Use Loan EMI for bank loans." },
  OTHER_DEBIT: { label: "Other (money out)", type: "OTHER", direction: "DEBIT", accounts: ["bank", "card", "cash"], help: "Anything else leaving an account." },
  OTHER_CREDIT: { label: "Other (money in)", type: "OTHER", direction: "CREDIT", accounts: ["bank", "card", "cash"], help: "Anything else entering an account." },
};

/** Reverse mapping: ledger row → user kind. */
export function kindOf(type: LedgerType | string, direction: Direction): TransactionKind {
  if (type === "OTHER") return direction === "DEBIT" ? "OTHER_DEBIT" : "OTHER_CREDIT";
  if (type === "BORROWING") return direction === "DEBIT" ? "LENT" : "BORROWED";
  const k = (TRANSACTION_KINDS as readonly string[]).includes(type) ? (type as TransactionKind) : "OTHER_DEBIT";
  return k;
}

/** "bank:<id>" | "card:<id>" | "cash:<id>" */
export type AccountRef = `${"bank" | "card" | "cash"}:${string}`;

export function parseAccountRef(ref: string | null | undefined): { kind: "bank" | "card" | "cash"; id: string } | null {
  const m = /^(bank|card|cash):([A-Za-z0-9_-]{1,64})$/.exec(ref ?? "");
  return m ? { kind: m[1] as "bank" | "card" | "cash", id: m[2] } : null;
}

export function accountRefOf(t: { bankAccountId?: string | null; creditCardId?: string | null; cashAccountId?: string | null; transactionType?: string }): string | null {
  // For a card payment the *paying* account is the bank/cash side.
  if (t.bankAccountId) return `bank:${t.bankAccountId}`;
  if (t.cashAccountId) return `cash:${t.cashAccountId}`;
  if (t.creditCardId) return `card:${t.creditCardId}`;
  return null;
}

/** Category kinds that fit a user kind (mirrors categorization/engine allowedKindsFor). */
export function categoryKindsForKind(kind: TransactionKind): ("EXPENSE" | "INCOME" | "TRANSFER")[] {
  const s = KIND_SPECS[kind];
  if (s.type === "TRANSFER" || s.type === "CARD_PAYMENT" || s.type === "BORROWING") return ["TRANSFER"];
  if (s.direction === "CREDIT") return s.type === "REFUND" || s.type === "REVERSAL" ? ["EXPENSE"] : ["INCOME"];
  return ["EXPENSE"];
}

export const INCOME_CATEGORY_LABELS: Record<string, string> = {
  SALARY: "Salary", FREELANCE: "Freelance", BUSINESS: "Business", RENTAL: "Rental", INTEREST: "Interest", INVESTMENT: "Investment", OTHER: "Other",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash", UPI: "UPI", DEBIT_CARD: "Debit card", CREDIT_CARD: "Credit card", NET_BANKING: "Net banking", BANK_TRANSFER: "Bank transfer", WALLET: "Wallet", OTHER: "Other",
};

export const TYPE_LABELS: Record<string, string> = {
  INCOME: "Income", EXPENSE: "Expense", TRANSFER: "Transfer", CARD_PAYMENT: "Card payment", EMI: "EMI", INVESTMENT: "Investment",
  REFUND: "Refund", REVERSAL: "Reversal", INTEREST: "Interest", FEE: "Fee", ATM_WITHDRAWAL: "ATM withdrawal", BORROWING: "Loan / borrowing", OTHER: "Other",
};

export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Manual", GMAIL: "Gmail", OUTLOOK: "Outlook", CSV: "CSV", XLSX: "Excel", PDF: "PDF", FUTURE_ANDROID_SMS: "Android SMS", GROWW: "Groww", SYSTEM: "System",
};
