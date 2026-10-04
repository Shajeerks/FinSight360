import type { Metadata } from "next";
import Link from "next/link";
import {
  Bell, Database, FileClock, FolderInput, KeyRound, Link2, Mail, Coins, Shapes, ShieldCheck, SlidersHorizontal, User, Wand2,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Settings" };

type Item = { href?: string; title: string; description: string; icon: LucideIcon; phase?: number };

const ITEMS: Item[] = [
  { href: "/settings/profile", title: "Profile", description: "Name, phone, timezone and currency", icon: User },
  { href: "/settings/security", title: "Security & Sign-in", description: "Password, Google sign-in, sessions", icon: ShieldCheck },
  { href: "/settings/audit-log", title: "Audit Log", description: "Sign-ins and important account activity", icon: FileClock },
  { href: "/accounts", title: "Bank Accounts & Wallets", description: "Accounts, cash wallets and balances", icon: Link2 },
  { title: "Connected Accounts", description: "Groww and other providers", icon: Link2, phase: 6 },
  { title: "Email Connections", description: "Gmail and Outlook imports", icon: Mail, phase: 5 },
  { title: "Notification Preferences", description: "In-app, browser and email alerts", icon: Bell, phase: 8 },
  { title: "Currency", description: "INR today — multi-currency ready", icon: Coins, phase: 7 },
  { href: "/settings/categories", title: "Categories", description: "Your own categories and sub-categories", icon: Shapes },
  { href: "/settings/rules", title: "Transaction Rules", description: "Automatic categorization rules", icon: Wand2 },
  { title: "Import Templates", description: "Saved column mappings per bank", icon: FolderInput, phase: 4 },
  { title: "Data Export", description: "Download all of your data", icon: Database, phase: 9 },
  { title: "Application Settings", description: "Defaults and preferences", icon: SlidersHorizontal, phase: 9 },
  { title: "Authentication Methods", description: "Add Microsoft sign-in", icon: KeyRound, phase: 5 },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your profile, security and preferences." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const body = (
            <Card className={item.href ? "h-full transition-colors hover:border-primary/40" : "h-full opacity-70"}>
              <CardContent className="flex items-start gap-3 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{item.title}</p>
                    {item.phase && <Badge variant="secondary">Phase {item.phase}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </CardContent>
            </Card>
          );
          return item.href ? (
            <Link key={item.title} href={item.href} className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              {body}
            </Link>
          ) : (
            <div key={item.title} aria-disabled>{body}</div>
          );
        })}
      </div>
    </div>
  );
}
