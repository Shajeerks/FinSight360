import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/services/profile.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileForm } from "@/features/settings/profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const p = await getProfile(user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Your personal details and regional preferences." />
      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          <CardDescription>Only you can see this information.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            email={p.email}
            defaults={{
              name: p.name ?? "",
              displayName: p.profile.displayName,
              phone: p.profile.phone,
              currency: "INR",
              timezone: p.profile.timezone,
              cardUtilizationAlertPct: p.profile.cardUtilizationAlertPct,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
