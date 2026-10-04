/**
 * Infers the ledger type of an imported row from its direction, account kind and
 * description. Conservative: anything unclear stays a plain EXPENSE / INCOME that
 * the user can change in review.
 */
export type ImportedType = "EXPENSE" | "INCOME" | "REFUND" | "REVERSAL" | "INTEREST" | "FEE" | "ATM_WITHDRAWAL" | "EMI" | "INVESTMENT" | "CARD_PAYMENT" | "TRANSFER";

export function classifyImported(direction: "DEBIT" | "CREDIT", accountKind: "bank" | "card" | "cash", description: string): ImportedType {
  const d = description.toUpperCase();
  if (accountKind === "card") {
    if (direction === "CREDIT") {
      if (/PAYMENT|THANK YOU|RECEIVED|AUTOPAY|BBPS|NEFT|IMPS|UPI/.test(d) && !/REFUND|REVERSAL/.test(d)) return "CARD_PAYMENT";
      if (/REVERSAL|REVERSED/.test(d)) return "REVERSAL";
      return "REFUND";
    }
    if (/\b(FEE|FEES|CHARGE|CHARGES|GST|IGST|FINANCE CHARGE|LATE PAYMENT|INTEREST)\b/.test(d)) return "FEE";
    if (/CASH (ADV|WITHDRAWAL)|ATM/.test(d)) return "ATM_WITHDRAWAL";
    return "EXPENSE";
  }
  if (direction === "CREDIT") {
    if (/REVERSAL|REVERSED|RVSL/.test(d)) return "REVERSAL";
    if (/REFUND|CASHBACK|CASH BACK/.test(d)) return "REFUND";
    if (/\bINT(EREST)?\.?\s?(PD|PAID|CR|CREDIT|ON)\b|SB INT|INTEREST/.test(d)) return "INTEREST";
    return "INCOME";
  }
  if (/\bATM\b|CASH WDL|CASH WITHDRAWAL|\bNWD\b|\bAWB\b/.test(d)) return "ATM_WITHDRAWAL";
  if (/CREDIT CARD|CC PAYMENT|CARD PAYMENT|CCPAY|CRED CLUB|AUTOPAY.*CARD|BILLDESK.*CARD/.test(d)) return "CARD_PAYMENT";
  if (/\bEMI\b|LOAN|ECS.*(HOME|CAR|AUTO|PERSONAL)/.test(d)) return "EMI";
  if (/\bSIP\b|MUTUAL FUND|\bMF\b|GROWW|ZERODHA|KUVERA|BSE STAR|NSE CLEARING|INDIAN CLEARING|ICCL/.test(d)) return "INVESTMENT";
  if (/\b(CHARGES|CHGS|FEE|FEES|PENALTY|GST|SMS ALERT|AMC|MIN BAL)\b/.test(d)) return "FEE";
  return "EXPENSE";
}

/** Payment rail from the description, for the expense detail row. */
export function paymentMethodFrom(description: string, accountKind: "bank" | "card" | "cash"): "UPI" | "NET_BANKING" | "BANK_TRANSFER" | "DEBIT_CARD" | "CREDIT_CARD" | "CASH" | "OTHER" {
  if (accountKind === "card") return "CREDIT_CARD";
  if (accountKind === "cash") return "CASH";
  const d = description.toUpperCase();
  if (/\bUPI\b/.test(d)) return "UPI";
  if (/\b(NEFT|IMPS|RTGS)\b/.test(d)) return "BANK_TRANSFER";
  if (/\b(POS|ECOM|DEBIT CARD|VISA|MASTER|RUPAY)\b/.test(d)) return "DEBIT_CARD";
  if (/\b(NETBANKING|NET BANKING|INB|BILLPAY|BIL\/)\b/.test(d)) return "NET_BANKING";
  return "OTHER";
}

/** Find a reference/UTR-like token (10–22 alphanumerics with digits). */
export function extractReference(description: string): string | null {
  const m = description.match(/\b(?=[A-Z0-9]*\d)[A-Z0-9]{10,22}\b/i);
  return m ? m[0].toUpperCase() : null;
}

const BANKS: [RegExp, string][] = [
  [/\bHDFC\b/i, "HDFC Bank"], [/\bICICI\b/i, "ICICI Bank"], [/STATE BANK OF INDIA|\bSBI\b/i, "State Bank of India"], [/\bAXIS\b/i, "Axis Bank"],
  [/\bKOTAK\b/i, "Kotak Mahindra Bank"], [/\bYES BANK\b/i, "Yes Bank"], [/\bIDFC\b/i, "IDFC FIRST Bank"], [/\bINDUSIND\b/i, "IndusInd Bank"],
  [/BANK OF BARODA|\bBOB\b/i, "Bank of Baroda"], [/PUNJAB NATIONAL|\bPNB\b/i, "Punjab National Bank"], [/\bCANARA\b/i, "Canara Bank"],
  [/\bFEDERAL BANK\b/i, "Federal Bank"], [/\bAU SMALL\b|\bAU BANK\b/i, "AU Small Finance Bank"], [/\bRBL\b/i, "RBL Bank"],
  [/STANDARD CHARTERED/i, "Standard Chartered"], [/\bHSBC\b/i, "HSBC"], [/\bCITI\b/i, "Citibank"], [/AMERICAN EXPRESS|\bAMEX\b/i, "American Express"],
  [/UNION BANK/i, "Union Bank of India"], [/INDIAN OVERSEAS/i, "Indian Overseas Bank"], [/\bIDBI\b/i, "IDBI Bank"],
];

export function detectInstitution(text: string): string | null {
  const head = text.slice(0, 6000);
  for (const [re, name] of BANKS) if (re.test(head)) return name;
  return null;
}
