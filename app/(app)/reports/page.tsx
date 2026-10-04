import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { buildReport, REPORT_LABEL, REPORT_TYPES, type Report } from "@/services/report.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select-native";
import { Alert } from "@/components/ui/alert";
import { ReportTable } from "@/features/reports/report-table";

export const metadata: Metadata = { title: "Reports" };

const iso = (d: Date) => d.toISOString().slice(0, 10);

function presets() {
  const n = new Date();
  const y = n.getUTCFullYear();
  const m = n.getUTCMonth();
  const fyStart = m >= 3 ? y : y - 1; // Indian financial year: April–March
  return [
    { label: "This month", from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) },
    { label: "Last month", from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) },
    { label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` },
    { label: `FY ${fyStart - 1}-${String(fyStart).slice(2)}`, from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` },
    { label: `Year ${y}`, from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

export default async function ReportsPage(props: PageProps<"/reports">) {
  const sp = await props.searchParams;
  const user = await requireUser();
  const q = { type: typeof sp.type === "string" ? sp.type : "expenses", from: typeof sp.from === "string" ? sp.from : undefined, to: typeof sp.to === "string" ? sp.to : undefined };
  let report: Report | null = null;
  let error: string | null = null;
  try {
    report = await buildReport(user.id, q);
  } catch (e) {
    error = e instanceof AppError ? e.message : "This report couldn't be built.";
    report = await buildReport(user.id, { type: "expenses" });
  }
  const qs = (extra: Record<string, string>) => new URLSearchParams({ type: report!.type, from: report!.from, to: report!.to, ...extra }).toString();

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Expense, income, card, loan, interest, investment and net-worth reports for any period — on screen, as CSV / Excel, or printed to PDF." />

      <Card>
        <CardContent className="space-y-4 p-4">
          <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end" method="get">
            <label className="grid gap-1.5 text-sm font-medium">Report
              <NativeSelect name="type" defaultValue={report.type}>{REPORT_TYPES.map((t) => <option key={t} value={t}>{REPORT_LABEL[t]}</option>)}</NativeSelect>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">From<Input type="date" name="from" defaultValue={report.from} /></label>
            <label className="grid gap-1.5 text-sm font-medium">To<Input type="date" name="to" defaultValue={report.to} /></label>
            <Button type="submit">Show</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            {presets().map((p) => (
              <Button key={p.label} asChild size="sm" variant={p.from === report!.from && p.to === report!.to ? "secondary" : "ghost"}>
                <Link href={`/reports?${new URLSearchParams({ type: report!.type, from: p.from, to: p.to })}`}>{p.label}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive">{error}</Alert>}

      <Card>
        <CardHeader className="flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{report.title}</CardTitle>
            <CardDescription>{report.from} to {report.to} · {report.rows.length} row{report.rows.length === 1 ? "" : "s"}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><a href={`/api/reports?${qs({ format: "csv" })}`} download><Download /> CSV</a></Button>
            <Button asChild size="sm" variant="outline"><a href={`/api/reports?${qs({ format: "xlsx" })}`} download><FileSpreadsheet /> Excel</a></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/reports/print?${qs({})}`} target="_blank"><Printer /> Print / PDF</Link></Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 sm:px-2 sm:pb-2">
          <ReportTable report={report} />
          {report.notes.map((n) => <p key={n} className="px-4 py-2 text-xs text-muted-foreground">{n}</p>)}
        </CardContent>
      </Card>
    </div>
  );
}
