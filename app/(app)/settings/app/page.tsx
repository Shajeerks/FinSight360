import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAppSettings } from "@/services/settings.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { PreferencesForm } from "@/features/settings/settings-components";

export const metadata: Metadata = { title: "Application settings" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function Fact({ label, on, detail }: { label: string; on: boolean; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      {on ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

export default async function AppSettingsPage() {
  const user = await requireUser();
  const s = await getAppSettings(user.id);
  const i = s.instance;
  return (
    <div className="space-y-6">
      <PageHeader title="Application Settings" description="Defaults and preferences for how FinSight360 works for you." />

      <Card id="regional">
        <CardHeader>
          <CardTitle>Currency, timezone & alerts</CardTitle>
          <CardDescription>Also shown on your Profile — changing them here changes them there.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm defaults={s.preferences} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Light, dark or follow your device. Saved on this device.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <span className="text-sm">Theme</span>
            <ThemeToggle />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>What you hear about, where, and how many days before a due date.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/notifications#settings" className="text-sm font-medium text-primary underline-offset-2 hover:underline">Open notification settings →</Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>This FinSight360 installation</CardTitle>
          <CardDescription>Server-side options. They are changed in the server&apos;s environment settings (.env / Vercel), not here.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            <Fact label="New sign-ups" on={i.registrationOpen} detail={i.registrationOpen ? "Anyone with the address can create an account. Set ALLOW_REGISTRATION=\"false\" once your own account exists." : "Turned off — only existing accounts can sign in."} />
            <Fact label="Email delivery" on={i.emailDelivery === "smtp"} detail={i.emailDelivery === "smtp" ? "Password-reset and opted-in notification emails are sent." : "Not set up — password-reset and notification emails are not delivered (EMAIL_TRANSPORT / SMTP_*)."} />
            <Fact label="Google sign-in" on={i.googleSignIn} detail={i.googleSignIn ? "Available on the sign-in page." : "Not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)."} />
            <Fact label="Microsoft sign-in" on={i.microsoftSignIn} detail={i.microsoftSignIn ? "Available on the sign-in page." : "Not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)."} />
            <Fact label="Gmail import" on={i.gmailImport} detail={i.gmailImport ? "Bank alert emails can be imported from Gmail." : "Not configured (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET)."} />
            <Fact label="Outlook import" on={i.outlookImport} detail={i.outlookImport ? "Bank alert emails can be imported from Outlook." : "Not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET)."} />
            <Fact label="Background jobs" on={Boolean(i.lastDailyJobs)} detail={i.lastDailyJobs ? `Daily jobs (net worth, recurring payments, due reminders) last ran ${fmt.format(new Date(i.lastDailyJobs))}. Mailbox sync every ${i.emailSyncMinutes || "—"} minutes.` : "Daily jobs haven't run yet on this server (they run while the app is running, or with npm run jobs:daily)."} />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
