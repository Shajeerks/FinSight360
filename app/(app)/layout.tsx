import { requireUser } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/services/dashboard.service";
import { generateIfStale, getPreferences } from "@/services/notification.service";
import { BrowserNotifier } from "@/features/notifications/notification-components";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  // Due-date alerts are generated at most every 30 min per user (and daily by the scheduler).
  await generateIfStale(user.id);
  const [unread, prefs] = await Promise.all([getUnreadNotificationCount(user.id), getPreferences(user.id)]);
  const browserOn = Object.values(prefs).some((p) => p.BROWSER.enabled);
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:pl-64">
        <Topbar user={user} unreadNotifications={unread} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10">{children}</main>
      </div>
      <MobileNav />
      <BrowserNotifier enabled={browserOn} />
    </div>
  );
}
