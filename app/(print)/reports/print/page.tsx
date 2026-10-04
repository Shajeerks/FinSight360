import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { buildReport } from "@/services/report.service";
import { ReportTable } from "@/features/reports/report-table";
import { PrintButton } from "@/features/reports/print-button";

export const metadata: Metadata = { title: "Print report" };

export default async function PrintReportPage(props: PageProps<"/reports/print">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const report = await buildReport(user.id, { type: sp.type, from: sp.from, to: sp.to });
  return (
    <div className="mx-auto max-w-5xl p-6 print:p-0">
      <div className="mb-4 flex items-start justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-neutral-500">FinSight360</p>
          <h1 className="text-xl font-semibold">{report.title}</h1>
          <p className="text-sm text-neutral-600">{report.from} to {report.to} · {user.name ?? user.email} · generated {new Date().toISOString().slice(0, 10)}</p>
        </div>
        <PrintButton />
      </div>
      <ReportTable report={report} compact />
      {report.notes.map((n) => <p key={n} className="mt-2 text-xs text-neutral-500">{n}</p>)}
      <p className="mt-6 text-[10px] text-neutral-400">Personal financial analysis — not financial advice.</p>
    </div>
  );
}
