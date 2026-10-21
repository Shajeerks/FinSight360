import type { Metadata } from "next";
import { FileJson, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Data export" };

export default async function DataExportPage() {
  await requireUser();
  return (
    <div className="space-y-6">
      <PageHeader title="Data Export" description="Download a complete copy of everything in your FinSight360 account." />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-4" /> Excel workbook</CardTitle>
            <CardDescription>One sheet per section — accounts, cards, all transactions, loans with schedules and payments, investments, budgets, reminders, rules, net-worth history and your activity log.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild><a href="/api/export?format=xlsx" download>Download .xlsx</a></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileJson className="size-4" /> JSON</CardTitle>
            <CardDescription>The same data in a machine-readable file — useful as a backup or to move your data to another tool.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><a href="/api/export?format=json" download>Download .json</a></Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" /> What&apos;s left out</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Your password, sign-in and mailbox access tokens, the contents of emails, and uploaded statement files are never included.</p>
          <p>The file contains your complete financial history — store it somewhere safe. Each download is recorded in your Audit Log. For reports for a period, use <a href="/reports" className="underline underline-offset-2">Reports</a>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
