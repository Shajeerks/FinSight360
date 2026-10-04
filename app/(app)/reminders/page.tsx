import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Reminders" };

export default function Page() {
  return (
    <ComingSoon
      title="Reminders"
      description="Never miss a due date."
      phase={8}
      icon={BellRing}
      features={["Credit-card dues and loan EMIs", "Insurance, SIP, subscriptions and bills", "Upcoming, due today, overdue, completed", "Custom reminders"]}
    />
  );
}
