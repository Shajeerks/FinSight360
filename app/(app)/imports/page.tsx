import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileSpreadsheet, FileText, History, Upload } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listImports } from "@/services/import.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { countPending } from "@/services/duplicate.service";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { UploadStatementForm } from "@/features/imports/upload-form";
import { UndoImportButton } from "@/features/imports/import-buttons";
import { accountLabelOf, IMPORT_STATUS_LABEL } from "@/features/imports/labels";

export const metadata: Metadata = { title: "Upload Statement" };

export default async function ImportsPage() {
  const user = await requireUser();
  const [imports, options, pending] = await Promise.all([listImports(user.id), getTransactionFormOptions(user.id), countPending(user.id)]);
  const accounts = options.accounts.filter((a) => a.kind !== "cash") as { ref: string; label: string; kind: "bank" | "card" }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload Statement"
        description="Import bank and credit-card statements (CSV, XLSX or PDF). You preview everything before it's added, and duplicates are caught automatically."
        actions={
          pending.duplicates + pending.review > 0 ? (
            <div className="flex gap-2">
              {pending.duplicates > 0 && <Button asChild variant="outline" size="sm"><Link href="/imports/duplicates">{pending.duplicates} duplicate{pending.duplicates === 1 ? "" : "s"} to review</Link></Button>}
              {pending.review > 0 && <Button asChild variant="outline" size="sm"><Link href="/imports/review">{pending.review} waiting for approval</Link></Button>}
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="size-4" /> New import</CardTitle>
            <CardDescription>Download the statement from your bank&apos;s net-banking (CSV or Excel is most accurate).</CardDescription>
          </CardHeader>
          <CardContent>
            <UploadStatementForm accounts={accounts} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="size-4" /> Import history</CardTitle>
            <CardDescription>Every import can be undone.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {imports.length === 0 ? (
              <EmptyState className="m-4" icon={FileSpreadsheet} title="No imports yet" description="Your uploaded statements will appear here." />
            ) : (
              <ul className="divide-y">
                {imports.map((i) => {
                  const st = IMPORT_STATUS_LABEL[i.status] ?? { label: i.status, variant: "secondary" as const };
                  const Icon = i.sourceType === "PDF" ? FileText : FileSpreadsheet;
                  return (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                      <Icon className="size-5 shrink-0 text-muted-foreground" />
                      <Link href={`/imports/${i.id}`} className="min-w-0 flex-1 rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <p className="truncate text-sm font-medium">{i.fileName ?? "Statement"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {accountLabelOf(i)} · {formatDate(i.createdAt)}
                          {i.status === "COMPLETED" && ` · ${i.importedCount} added, ${i.duplicateCount} linked`}
                        </p>
                      </Link>
                      <Badge variant={st.variant} className="hidden sm:inline-flex">{st.label}</Badge>
                      {i.status === "COMPLETED" ? <UndoImportButton id={i.id} size="icon" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
