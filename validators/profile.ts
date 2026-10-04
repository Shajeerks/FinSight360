import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["INR"] as const;

const timezones = (() => {
  try {
    return new Set(Intl.supportedValuesOf("timeZone"));
  } catch {
    return new Set(["Asia/Kolkata", "UTC"]);
  }
})();

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  displayName: z.string().trim().max(40).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{0,20}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  currency: z.enum(SUPPORTED_CURRENCIES),
  timezone: z.string().refine((tz) => timezones.has(tz) || tz === "Asia/Kolkata", "Unknown timezone"),
  cardUtilizationAlertPct: z.coerce.number().min(1, "Between 1 and 100").max(100, "Between 1 and 100"),
});

export type ProfileInput = z.input<typeof profileSchema>;
