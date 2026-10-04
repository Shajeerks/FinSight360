import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  CreditCard,
  HandCoins,
  Wallet,
  Receipt,
  TrendingUp,
  Upload,
  CopyCheck,
  ListChecks,
  Mail,
  BellRing,
  BarChart3,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Monthly Analysis", icon: BarChart3 },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/income", label: "Income", icon: Wallet },
      { href: "/expenses", label: "Expenses", icon: Receipt },
      { href: "/accounts", label: "Bank Accounts", icon: Landmark },
      { href: "/credit-cards", label: "Credit Cards", icon: CreditCard },
    ],
  },
  {
    title: "Loans & Wealth",
    items: [
      { href: "/loans", label: "Loans & EMI", icon: HandCoins },
      { href: "/investments", label: "Investments", icon: TrendingUp },
    ],
  },
  {
    title: "Import",
    items: [
      { href: "/imports", label: "Upload Statement", icon: Upload },
      { href: "/imports/duplicates", label: "Review Duplicates", icon: CopyCheck },
      { href: "/imports/review", label: "Review Queue", icon: ListChecks },
      { href: "/imports/email", label: "Email Sync", icon: Mail },
    ],
  },
  {
    title: "Planning",
    items: [
      { href: "/reminders", label: "Reminders", icon: BellRing },
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/** Primary destinations in the iPhone bottom bar (the rest live under "More"). */
export const MOBILE_PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/transactions", label: "Activity", icon: ArrowLeftRight },
  { href: "/credit-cards", label: "Cards", icon: CreditCard },
  { href: "/loans", label: "Loans", icon: HandCoins },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/imports") return pathname === "/imports";
  return pathname === href || pathname.startsWith(`${href}/`);
}
