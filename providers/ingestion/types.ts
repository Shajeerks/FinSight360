/**
 * Transaction-ingestion provider contract.
 *
 * Every source (manual entry, CSV/XLSX/PDF statements, Gmail, Outlook and —
 * in future — Android SMS) implements this interface and emits
 * `NormalizedTransactionCandidate`s. The import pipeline then runs
 * categorization + duplicate detection and writes ONE row to the central
 * `transactions` ledger, recording the source in `transaction_sources`.
 *
 * iPhone note: iOS does not allow apps or PWAs to read the SMS inbox, so there
 * is no SMS provider for iPhone. `FUTURE_ANDROID_SMS` is reserved for a future
 * Android companion app that would forward messages with the user's consent.
 */
import type { SourceType, TransactionDirection, TransactionType } from "@prisma/client";

export type NormalizedTransactionCandidate = {
  sourceType: SourceType;
  /** Stable id within the source (email message id, file-row hash…) — prevents re-importing. */
  externalId: string;
  transactionDate: Date;
  transactionAt?: Date | null;
  /** Positive decimal string, e.g. "1250.00" — never a float. */
  amount: string;
  direction: TransactionDirection;
  transactionType: TransactionType;
  currency: string;
  description: string;
  merchantName?: string | null;
  referenceNumber?: string | null;
  accountLast4?: string | null;
  cardLast4?: string | null;
  balanceAfter?: string | null;
  /** 0–100: how sure the parser is about this extraction. */
  confidence: number;
  raw?: Record<string, unknown>;
};

export type IngestionContext = { userId: string; importId?: string };

export interface TransactionIngestionProvider<Input = unknown> {
  readonly sourceType: SourceType;
  /** Human-readable name shown in the UI. */
  readonly displayName: string;
  /** Whether this provider can run in the current environment/platform. */
  isAvailable(): boolean;
  extract(input: Input, ctx: IngestionContext): Promise<NormalizedTransactionCandidate[]>;
}
