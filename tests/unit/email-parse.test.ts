import { describe, expect, it } from "vitest";
import { parseBankAlert, senderBank } from "@/lib/email/parse";
import { gmailPayloadText, htmlToText } from "@/lib/email/text";

const at = new Date("2026-10-05T10:00:00Z");
const p = (from: string, subject: string, text: string, receivedAt = at) => parseBankAlert({ from, subject, text, receivedAt });
const ok = (r: ReturnType<typeof parseBankAlert>) => {
  if (!r.ok) throw new Error(`expected a transaction, got: ${r.reason}`);
  return r.txn;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("bank alert parser", () => {
  it("HDFC UPI debit", () => {
    const t = ok(p("HDFC Bank InstaAlerts <alerts@hdfcbank.net>", "❗ You have done a UPI txn. Check details!", "Dear Customer, Rs.645.00 has been debited from account **4821 to VPA swiggy@icici SWIGGY on 03-10-26. Your UPI transaction reference number is 412345678901. If you did not authorize this transaction, please report it immediately."));
    expect(t).toMatchObject({ amount: "645.00", direction: "DEBIT", instrument: "bank", accountLast4: "4821", merchantName: "SWIGGY", referenceNumber: "412345678901", transactionType: "EXPENSE", bank: "HDFC Bank" });
    expect(iso(t.transactionDate)).toBe("2026-10-03");
    expect(t.confidence).toBeGreaterThanOrEqual(90);
  });

  it("HDFC credit card spend with time and available limit (limit ignored)", () => {
    const t = ok(p("alerts@hdfcbank.net", "Alert : Update on your HDFC Bank Credit Card", "Dear Card Member, Thank you for using your HDFC Bank Credit Card ending 1043 for Rs 1,250.00 at AMAZON PAY INDIA on 05-10-2026 14:32:11. Authorization code:- 012345. Available limit Rs 2,45,000.00"));
    expect(t).toMatchObject({ amount: "1250.00", direction: "DEBIT", instrument: "card", cardLast4: "1043", merchantName: "AMAZON PAY INDIA", transactionType: "EXPENSE" });
    expect(t.transactionAt?.toISOString()).toBe("2026-10-05T09:02:11.000Z"); // 14:32:11 IST
  });

  it("ICICI account alert where the payee is 'credited' after the account is 'debited'", () => {
    const t = ok(p("credit_cards@icicibank.com", "Transaction alert", "ICICI Bank Acct XX821 debited for Rs 645.00 on 03-Oct-26; SWIGGY credited. UPI:412345678901. Call 18002662 for dispute."));
    expect(t).toMatchObject({ direction: "DEBIT", accountLast4: "821", merchantName: "SWIGGY", amount: "645.00" });
    expect(iso(t.transactionDate)).toBe("2026-10-03");
  });

  it("ICICI card spend and Avl Limit", () => {
    const t = ok(p("credit_cards@icicibank.com", "Transaction alert for your ICICI Bank Credit Card", "INR 1,250.00 spent using ICICI Bank Card XX8812 on 05-Oct-26 on AMAZON. Avl Limit: INR 1,48,750.00."));
    expect(t).toMatchObject({ amount: "1250.00", instrument: "card", cardLast4: "8812", direction: "DEBIT" });
  });

  it("SBI salary credit (balance ignored, compact date)", () => {
    const t = ok(p("cbssbi.cas@alerts.sbi.co.in", "Transaction Alert", "Dear Customer, Your A/C XXXXX7703 Credited INR 85,000.00 on 01/10/26 -Deposit by transfer from ACME TECH. Avl Bal INR 3,77,400.00-SBI"));
    expect(t).toMatchObject({ amount: "85000.00", direction: "CREDIT", accountLast4: "7703", transactionType: "INCOME", merchantName: "ACME TECH" });
  });

  it("SBI debit with ddMMMyy date", () => {
    const t = ok(p("donotreply.sbiatm@alerts.sbi.co.in", "Transaction Alert", "Dear Customer, Your A/C XXXXX7703 has been debited by Rs.645.00 on 03Oct26 transfer to SWIGGY Ref No 412345678901. If not done by you, call 1800111109 -SBI"));
    expect(t).toMatchObject({ direction: "DEBIT", merchantName: "SWIGGY", referenceNumber: "412345678901" });
    expect(iso(t.transactionDate)).toBe("2026-10-03");
  });

  it("Axis card spend and Axis UPI 'Info' merchant", () => {
    const a = ok(p("alerts@axisbank.com", "Transaction alert", "Transaction alert: INR 499 spent on Axis Bank Credit Card no. XX5530 at NETFLIX on 04-10-2026 10:15:00 IST. Available Limit: INR 1,20,000"));
    expect(a).toMatchObject({ amount: "499.00", instrument: "card", cardLast4: "5530", merchantName: "NETFLIX" });
    const b = ok(p("alerts@axisbank.com", "Debit alert", "INR 649.00 debited from A/c no. XX9911 on 04-10-2026 at 18:22:01 IST. Info- UPI/P2M/412398765432/ZOMATO. Not you? Call 18004195577"));
    expect(b).toMatchObject({ amount: "649.00", accountLast4: "9911", direction: "DEBIT", merchantName: "ZOMATO" });
  });

  it("card bill payment received on the card, and paid from a bank account", () => {
    const c = ok(p("alerts@hdfcbank.net", "Payment received", "Payment of Rs. 24,500.00 has been received towards your HDFC Bank Credit Card ending 1043 on 04-10-2026. Thank you."));
    expect(c).toMatchObject({ direction: "CREDIT", instrument: "card", cardLast4: "1043", transactionType: "CARD_PAYMENT" });
    const b = ok(p("alerts@hdfcbank.net", "Debit alert", "Rs.24,500.00 debited from A/c XX4821 on 04-10-26 towards payment of HDFC Bank Credit Card XX1043. Ref 0410BILLPAY99."));
    expect(b).toMatchObject({ direction: "DEBIT", instrument: "bank", accountLast4: "4821", cardLast4: "1043", transactionType: "CARD_PAYMENT" });
  });

  it("refund to card, ATM withdrawal, Kotak 'Sent'", () => {
    expect(ok(p("alerts@hdfcbank.net", "Refund", "Rs.200.00 has been credited to your HDFC Bank Credit Card ending 1043 towards refund from AMAZON on 04-10-2026"))).toMatchObject({ direction: "CREDIT", transactionType: "REFUND", merchantName: "AMAZON" });
    expect(ok(p("alerts@hdfcbank.net", "ATM", "Rs.2000 withdrawn from A/c XX4821 at ATM MG ROAD on 04-10-26"))).toMatchObject({ transactionType: "ATM_WITHDRAWAL", amount: "2000.00" });
    expect(ok(p("BankAlerts@kotak.com", "Kotak alert", "Sent Rs.300.00 from Kotak Bank AC X1234 to merchant@okaxis on 02-10-26.UPI Ref 412311112222."))).toMatchObject({ direction: "DEBIT", accountLast4: "1234", referenceNumber: "412311112222" });
  });

  it("rejects OTPs, declined payments, statements, reminders and offers", () => {
    const bad = [
      ["OTP", "Your OTP for transaction of Rs.1250.00 at AMAZON is 123456. Do not share it with anyone."],
      ["Declined", "Your transaction of Rs.1250.00 at AMAZON using card ending 1043 was declined due to incorrect PIN."],
      ["Statement", "Your HDFC Bank Credit Card statement for Oct 2026 is ready. Total Amount Due Rs 24,500.00. Minimum Amount Due Rs 1,225."],
      ["Reminder", "Reminder: payment of Rs 24,500 is due on 20-10-2026 for card ending 1043."],
      ["Offer", "Congratulations! You are eligible for a pre-approved loan of Rs 5,00,000."],
    ];
    for (const [subject, text] of bad) expect(p("alerts@hdfcbank.net", subject, text).ok).toBe(false);
  });

  it("unknown senders are capped below auto-confirm confidence; stale dates fall back to the received date", () => {
    const t = ok(p("noreply@randomshop.example", "Payment", "Rs 999 debited from your account ending 4821 at RANDOMSHOP"));
    expect(t.confidence).toBeLessThanOrEqual(75);
    const old = ok(p("alerts@hdfcbank.net", "x", "Rs.645.00 debited from account **4821 on 03-01-2020"));
    expect(iso(old.transactionDate)).toBe("2026-10-05");
    expect(senderBank("Axis Bank <alerts@axisbank.com>")?.bank).toBe("Axis Bank");
  });
});

describe("message text helpers", () => {
  it("prefers text/plain parts and converts HTML otherwise", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    expect(gmailPayloadText({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("Rs.645.00 has been debited from account **4821") } }, { mimeType: "text/html", body: { data: b64("<b>x</b>") } }] })).toContain("Rs.645.00");
    expect(gmailPayloadText({ mimeType: "text/html", body: { data: b64("<html><style>p{}</style><p>Rs.&nbsp;645.00 debited</p><p>A/c&nbsp;XX4821</p></html>") } })).toBe("Rs. 645.00 debited\nA/c XX4821");
    expect(htmlToText("<td>Amount</td><td>&#8377;1,250</td>")).toBe("Amount ₹1,250");
  });
});
