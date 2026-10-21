import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/validators/profile";

let timezones: Set<string> | null = null;
function isTimezone(tz: string) {
  timezones ??= new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Kolkata"]);
  return tz === "Asia/Kolkata" || tz === "UTC" || timezones.has(tz);
}

export const preferencesSchema = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
  timezone: z.string().refine(isTimezone, "Unknown timezone"),
  cardUtilizationAlertPct: z.coerce.number().int("Whole numbers only").min(1, "Between 1 and 100").max(100, "Between 1 and 100"),
});
export type PreferencesInput = z.input<typeof preferencesSchema>;

export const templateRenameSchema = z.object({ name: z.string().trim().min(2, "At least 2 characters").max(60, "Up to 60 characters") });
export type TemplateRenameInput = z.input<typeof templateRenameSchema>;
