import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Monthly Analysis" };

export default function Page() {
  return (
    <ComingSoon
      title="Monthly Analysis"
      description="Spending intelligence and trends."
      phase={7}
      icon={BarChart3}
      features={["Month-on-month and category growth", "Recurring commitments", "Savings, investment and EMI ratios", "Unusual and large transactions"]}
    />
  );
}
