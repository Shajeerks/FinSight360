import { describe, expect, it } from "vitest";
import { imapHostFor, imapLabel, isStatementFile, suggestStatementAccount, type AccountHint } from "@/lib/email/statements";
import { gmailStatementParts } from "@/lib/email/text";
import { emailImapConnectSchema } from "@/validators/email";

const accounts: AccountHint[] = [
  { ref: "bank:hdfc", kind: "bank", bankName: "HDFC Bank", last4: "4821" },
  { ref: "card:hdfc", kind: "card", bankName: "HDFC", last4: "1043" },
  { ref: "card:icici", kind: "card", bankName: "ICICI Bank", last4: "6634" },
  { ref: "bank:kotak", kind: "bank", bankName: "Kotak Mahindra Bank", last4: null },
];

describe("statement attachments", () => {
  it("picks up PDF, CSV and XLSX files only", () => {
    expect(isStatementFile("Statement_Oct.PDF", null)).toBe(true);
    expect(isStatementFile("txns.csv", "text/plain")).toBe(true);
    expect(isStatementFile("stmt.xlsx", null)).toBe(true);
    expect(isStatementFile("noname", "application/pdf")).toBe(true);
    expect(isStatementFile("logo.png", "image/png")).toBe(false);
    expect(isStatementFile("old.xls", "application/vnd.ms-excel")).toBe(false);
  });

  it("matches the account by last 4 digits, else by the only account of that kind at the sending bank", () => {
    expect(suggestStatementAccount({ subject: "Statement for A/c XX4821", fileName: "s.pdf", bank: "HDFC Bank" }, accounts)).toBe("bank:hdfc");
    expect(suggestStatementAccount({ subject: "Your statement", fileName: "6634_Oct.pdf", bank: null }, accounts)).toBe("card:icici");
    expect(suggestStatementAccount({ subject: "Your HDFC Bank Credit Card statement", fileName: "s.pdf", bank: "HDFC Bank" }, accounts)).toBe("card:hdfc");
    expect(suggestStatementAccount({ subject: "Account statement for October", fileName: "s.pdf", bank: "Kotak" }, accounts)).toBe("bank:kotak");
    // Two HDFC products and nothing says which: you choose.
    expect(suggestStatementAccount({ subject: "Your e-statement", fileName: "s.pdf", bank: "HDFC Bank" }, accounts)).toBeNull();
    // Digits inside a longer number don't count.
    expect(suggestStatementAccount({ subject: "Ref 948213", fileName: "s.pdf", bank: null }, accounts)).toBeNull();
  });

  it("fills in the IMAP server for common providers", () => {
    expect(imapHostFor("me@gmail.com")).toBe("imap.gmail.com");
    expect(imapHostFor("me@yahoo.co.in")).toBe("imap.mail.yahoo.com");
    expect(imapHostFor("me@ymail.com")).toBe("imap.mail.yahoo.com");
    expect(imapHostFor("me@hotmail.com")).toBe("outlook.office365.com");
    expect(imapHostFor("me@company.in")).toBeNull();
    expect(imapLabel("imap.mail.yahoo.com")).toBe("Yahoo Mail");
    expect(imapLabel("imap.gmail.com")).toBe("Gmail");
  });

  it("lists Gmail attachments with their ids", () => {
    const parts = gmailStatementParts({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: "aGk" } },
        { mimeType: "application/pdf", filename: "Statement.pdf", body: { attachmentId: "A1", size: 1200 } },
      ],
    });
    expect(parts).toEqual([{ ref: "A1", fileName: "Statement.pdf", mimeType: "application/pdf", size: 1200 }]);
  });

  it("app passwords: spaces removed, short ones rejected", () => {
    expect(emailImapConnectSchema.parse({ email: " Me@Yahoo.com ", appPassword: "abcd efgh ijkl mnop" })).toEqual({ email: "me@yahoo.com", appPassword: "abcdefghijklmnop", host: "" });
    expect(emailImapConnectSchema.safeParse({ email: "me@yahoo.com", appPassword: "short" }).success).toBe(false);
    expect(emailImapConnectSchema.safeParse({ email: "me@x.com", appPassword: "abcdefghijkl", host: "bad host" }).success).toBe(false);
  });
});
