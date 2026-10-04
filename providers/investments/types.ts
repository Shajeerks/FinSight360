/**
 * Investment data provider contract (Groww and others).
 *
 * FinSight360 never asks for broker passwords or OTPs and never
 * reverse-engineers private APIs. A provider is either:
 *  • FILE_IMPORT — parses statements/holdings files the user exports, or
 *  • API — uses an officially documented API the user has authorized.
 */
import type { InstrumentType, InvestmentTxnType } from "@prisma/client";

export type ProviderHolding = {
  instrumentName: string;
  instrumentType: InstrumentType;
  isin?: string | null;
  symbol?: string | null;
  quantity: string;
  averageBuyPrice: string;
  investedAmount: string;
  currentPrice?: string | null;
  currentValue?: string | null;
};

export type ProviderTransaction = {
  externalId: string;
  /** When the file says (or the name implies) what kind of instrument it is. */
  instrumentType?: InstrumentType;
  type: InvestmentTxnType;
  tradeDate: Date;
  instrumentName: string;
  isin?: string | null;
  symbol?: string | null;
  quantity: string;
  price: string;
  amount: string;
  charges?: string;
};

export interface InvestmentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly method: "API" | "FILE_IMPORT";
  importHoldings(input: { fileName: string; data: Buffer } | { connectionId: string }): Promise<ProviderHolding[]>;
  importTransactions(input: { fileName: string; data: Buffer } | { connectionId: string }): Promise<ProviderTransaction[]>;
}
