import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getProfile, getRecentAuditLog } from "@/services/profile.service";
import { isGoogleAuthEnabled } from "@/lib/env";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChangePasswordForm, ResendVerificationButton, SignOutEverywhereButton } from "@/features/settings/security-forms";
import { describeAuditAction } from "@/features/settings/audit-labels";

export const metadata: Metadata = { title: "Security" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export default async function SecurityPage() {
  const user = await requireUser();
  const [p, log] = await Promise.all([getProfile(user.id), getRecentAuditLog(user.id, 8)]);
  const google = p.providers.includes("google");

  return (
    <div className="space-y-6">
      <PageHeader title="Security & Sign-in" description="Protect access to your financial data." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>{p.email}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            {p.emailVerified ? (
              <Badge variant="success"><CheckCircle2 /> Verified</Badge>
            ) : (
              <>
                <Badge variant="warning"><AlertCircle /> Not verified</Badge>
                <ResendVerificationButton />
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sign-in methods</CardTitle>
            <CardDescription>Ways you can access FinSight360</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant={p.hasPassword ? "success" : "secondary"}>Email & password {p.hasPassword ? "· on" : "· not set"}</Badge>
            <Badge variant={google ? "success" : "secondary"}>
              Google {google ? "· linked" : isGoogleAuthEnabled() ? "· sign in with Google to link" : "· not configured"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{p.hasPassword ? "Change password" : "Set a password"}</CardTitle>
          <CardDescription>Passwords are stored only as a salted bcrypt hash.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm hasPassword={p.hasPassword} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessions</CardTitle>
          <CardDescription>Sessions expire automatically. Lost a device? Sign out everywhere.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Last sign-in: {p.lastLoginAt ? fmt.format(p.lastLoginAt) : "—"}
          </p>
          <SignOutEverywhereButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>From your audit log</CardDescription>
          </div>
          <Link href="/settings/audit-log" className="text-sm text-primary hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {log.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{describeAuditAction(e.action)}</span>
                <span className="text-xs text-muted-foreground">{fmt.format(e.createdAt)}{e.ipAddress ? ` · ${e.ipAddress}` : ""}</span>
              </li>
            ))}
            {!log.length && <li className="py-4 text-muted-foreground">No activity yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
