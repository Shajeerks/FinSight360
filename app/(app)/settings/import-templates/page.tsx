import type { Metadata } from "next";
import Link from "next/link";
import { FolderInput } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listImportTemplates } from "@/services/settings.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TemplateActions } from "@/features/settings/settings-components";

export const metadata: Metadata = { title: "Import templates" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
const MODE: Record<string, string> = { DEBIT_CREDIT_COLUMNS: "Separate debit / credit columns", SIGNED_AMOUNT: "One signed amount column", AMOUNT_WITH_TYPE: "Amount + Dr/Cr column" };
const FIELD: Record<string, string> = { transactionDate: "Date", valueDate: "Value date", description: "Description", debit: "Debit", credit: "Credit", amount: "Amount", type: "Dr/Cr", balance: "Balance", referenceNumber: "Reference" };

export default async function ImportTemplatesPage() {
  const user = await requireUser();
  const templates = await listImportTemplates(user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Import Templates" description="Column mappings you saved for CSV / Excel statements. The matching template is picked automatically when you upload the same bank's file again." />
      {templates.length === 0 ? (
        <EmptyState icon={FolderInput} title="No saved templates yet" description="When you upload a CSV or Excel statement, tick “Save this mapping” on the mapping step to reuse it next time. PDF statements don't need a template." action={<Link href="/imports" className="text-sm font-medium text-primary underline-offset-2 hover:underline">Upload a statement</Link>} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Saved templates</CardTitle>
            <CardDescription>Deleting a template never changes statements you already imported.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{t.name}</p>
                      <Badge variant="secondary">{t.fileType}</Badge>
                      {t.institution && <Badge variant="outline">{t.institution}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {MODE[t.amountMode] ?? t.amountMode} · dates {t.dateFormat} · header on row {t.headerRow}
                      {t.mappedColumns.length ? ` · ${t.mappedColumns.map((c) => FIELD[c] ?? c).join(", ")}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">Used {t.uses} time{t.uses === 1 ? "" : "s"} · last changed {fmt.format(t.updatedAt)}</p>
                  </div>
                  <TemplateActions id={t.id} name={t.name} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
