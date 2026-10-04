import Link from "next/link";
import { CreditCard, HandCoins, Landmark, TrendingUp, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  { href: "/accounts", label: "Add Bank Account", icon: Landmark },
  { href: "/credit-cards", label: "Add Credit Card", icon: CreditCard },
  { href: "/loans", label: "Add Loan", icon: HandCoins },
  { href: "/investments", label: "Add Investment", icon: TrendingUp },
  { href: "/imports", label: "Upload Statement", icon: Upload },
];

export function GettingStarted({ name }: { name: string | null }) {
  return (
    <Card className="border-primary/25 bg-gradient-to-br from-primary/8 via-card to-card">
      <CardHeader>
        <CardTitle className="text-lg">Welcome{name ? `, ${name.split(" ")[0]}` : ""}! Let&apos;s set up your finances</CardTitle>
        <CardDescription>Your dashboard fills in as you add accounts. Nothing here is estimated or made up.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {STEPS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex min-h-12 items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-primary/5">
              <Icon className="size-4 text-primary" /> {label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
