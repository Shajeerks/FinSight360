import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <ComingSoon
      title="Notifications"
      description="Alerts about dues, utilization and imports."
      phase={8}
      icon={Bell}
      features={["In-app notifications", "Browser notifications where supported", "Email notifications", "Notification preferences"]}
    />
  );
}
