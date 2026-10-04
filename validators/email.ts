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
