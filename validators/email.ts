import { z } from "zod";
import { boolField } from "@/validators/common";

export const emailSyncSchema = z.object({
  /** How far back the FIRST sync of a mailbox looks. */
  days: z.coerce.number().int().min(1).max(365).default(60),
  deleteData: boolField,
});

export const emailCandidateDecisionSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    account: z.string().regex(/^(bank|card):[A-Za-z0-9_-]+$/, "Choose an account").optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "APPROVE" && !v.account) ctx.addIssue({ code: "custom", path: ["account"], message: "Choose the account this alert belongs to" });
  });

export const emailParsePreviewSchema = z.object({
  from: z.string().trim().max(200).default(""),
  subject: z.string().trim().max(300).default(""),
  text: z.string().trim().min(10, "Paste the alert text").max(10_000),
});

/** Connect a mailbox with an app password (IMAP). Spaces Google shows in app passwords are removed. */
export const emailImapConnectSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email address").max(200),
  appPassword: z
    .string()
    .transform((v) => v.replace(/\s+/g, ""))
    .pipe(z.string().min(8, "Paste the app password from your email provider").max(64)),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .regex(/^$|^[a-z0-9.-]+\.[a-z]{2,}$/, "Enter a mail server like imap.example.com")
    .optional()
    .default(""),
});

export const emailStatementImportSchema = z.object({
  account: z.string().regex(/^(bank|card):[A-Za-z0-9_-]+$/, "Choose the account this statement belongs to"),
  password: z.string().max(128).optional().nullable(),
});
