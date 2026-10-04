import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <ComingSoon
      title="Reports"
      description="Exportable financial reports."
      phase={7}
      icon={FileText}
      features={["Monthly expense, income, card, loan and interest reports", "Investment and net-worth reports", "CSV and Excel export", "Print-ready PDF layout"]}
    />
  );
}
