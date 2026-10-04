import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { generateIfStale, getPreferences, listNotifications, TYPE_LABEL } from "@/services/notification.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationList, PreferencesForm } from "@/features/notifications/notification-components";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  await generateIfStale(user.id, 0);
  const [items, prefs] = await Promise.all([listNotifications(user.id, { limit: 100 }), getPreferences(user.id)]);
  const emailConfigured = process.env.EMAIL_TRANSPORT === "smtp" && Boolean(process.env.SMTP_HOST);
  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Dues, EMIs, reminders, card utilization, budgets, imports and security alerts." />
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" description="You'll be told here before card bills, EMIs and your reminders fall due." />
      ) : (
        <NotificationList items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString(), read: Boolean(n.readAt), type: n.type }))} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Notification settings</CardTitle>
          <CardDescription>Choose what you hear about and where. Email is off until you switch it on.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm prefs={prefs} labels={TYPE_LABEL} emailConfigured={emailConfigured} />
        </CardContent>
      </Card>
    </div>
  );
}
