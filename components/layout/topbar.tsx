import Link from "next/link";
import { Bell } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";

export function Topbar({
  user,
  unreadNotifications,
}: {
  user: { name: string | null; email: string; image: string | null };
  unreadNotifications: number;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6 lg:px-8">
      <Link href="/dashboard" className="lg:hidden" aria-label="FinSight360 home">
        <Logo />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <Button asChild variant="ghost" size="icon" aria-label={`Notifications${unreadNotifications ? ` (${unreadNotifications} unread)` : ""}`}>
          <Link href="/notifications" className="relative">
            <Bell className="size-5" />
            {unreadNotifications > 0 && (
              <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Link>
        </Button>
        <div className="ml-1">
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
