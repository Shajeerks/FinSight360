import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CopyCheck, FileWarning, Link2, ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getImport } from "@/services/import.service";
import { getTransactionFormOptions } from "@/services/transaction.service";
import { NotFoundError } from "@/lib/errors";
import { formatDate } from "@/lib/dates";
import { SOURCE_LABELS } from "@/lib/transactions/kinds";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { MappingForm, type MappingInitial } from "@/features/imports/mapping-form";
import { ImportReviewTable, type ReviewRow } from "@/features/imports/review-table";
import { UndoImportButton } from "@/features/imports/import-buttons";
import { accountLabelOf, IMPORT_STATUS_LABEL } from "@/features/imports/labels";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage(props: PageProps<"/imports/[id]">) {
  const { id } = await props.params;
  const user = await requireUser();
  let detail;
  try {
    detail = await getImport(user.id, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { imp, rows, matched } = detail;
  const st = IMPORT_STATUS_LABEL[imp.status] ?? { label: imp.status, variant: "secondary" as const };
  const header = (
    <PageHeader
      title={imp.fileName ?? "Statement import"}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={st.variant}>{st.label}</Badge>
          <span>{accountLabelOf(imp)}</span>
          <span>· {SOURCE_LABELS[imp.sourceType]}</span>
          {imp.detectedInstitution && <span>· {imp.detectedInstitution}</span>}
          <span>· uploaded {formatDate(imp.createdAt)}</span>
        </span>
      }
      actions={
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm"><Link href="/imports"><ArrowLeft /> All imports</Link></Button>
          {imp.status === "COMPLETED" && <UndoImportButton id={imp.id} />}
        </div>
      }
    />
  );

  if (imp.status === "AWAITING_MAPPING") {
    const stored = (imp.columnMapping ?? { fields: {}, positiveIs: "CREDIT" }) as { fields: MappingInitial["fields"]; positiveIs: "CREDIT" | "DEBIT" };
    const sampleRows = rows.slice(0, 15).map((r) => ({ rowNumber: r.rowNumber, cells: (r.rawData as string[]).map(String) }));
    return (
      <div className="space-y-6">
        {header}
        <MappingForm
          importId={imp.id}
          sampleRows={sampleRows}
          templateName={imp.mappingTemplate?.name ?? null}
          initial={{ headerRowIndex: imp.headerRowIndex ?? 0, fields: stored.fields ?? {}, dateFormat: imp.dateFormat, amountMode: imp.amountMode, positiveIs: stored.positiveIs ?? "CREDIT" }}
        />
      </div>
    );
  }

  const options = imp.status === "AWAITING_REVIEW" ? await getTransactionFormOptions(user.id) : null;
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const reviewRows: ReviewRow[] = rows
    .filter((r) => !(r.status === "SKIPPED" && (r.errorMessage === "Header row" || r.errorMessage === "Above the header")))
    .map((r) => {
      const m = r.matchedTransactionId ? matched.get(r.matchedTransactionId) : undefined;
      return {
        id: r.id,
        rowNumber: imp.sourceType === "PDF" ? r.rowNumber : r.rowNumber + 1,
        date: iso(r.transactionDate),
        amount: r.amount?.toFixed(2) ?? null,
        direction: r.direction,
        description: r.description,
        referenceNumber: r.referenceNumber,
        status: r.status,
        include: r.include,
        transactionType: r.transactionType,
        categoryId: r.suggestedCategoryId,
        subCategoryId: r.suggestedSubCategoryId,
        confidence: r.confidenceScore === null ? null : Number(r.confidenceScore),
        duplicateScore: r.duplicateScore === null ? null : Number(r.duplicateScore),
        matchedFields: r.matchedFields,
        errorMessage: r.errorMessage,
        matched: m ? { date: iso(m.transactionDate)!, amount: m.amount.toFixed(2), description: m.description, source: SOURCE_LABELS[m.sourceType] ?? m.sourceType } : null,
      };
    });

  return (
    <div className="space-y-6">
      {header}
      {imp.status === "COMPLETED" && (
        <>
          <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Import summary">
            <StatCard title="Added" value={String(imp.newCount)} icon={CheckCircle2} tone="primary" sub="New transactions" />
            <StatCard title="Linked to existing" value={String(imp.duplicateCount)} icon={Link2} sub="Already in ledger — counted once" />
            <StatCard title="Possible duplicates" value={String(imp.possibleDuplicateCount)} icon={CopyCheck} sub="Pending your decision" />
            <StatCard title="Unreadable rows" value={String(imp.failedCount)} icon={FileWarning} sub="Not imported" />
          </section>
          {(imp.possibleDuplicateCount > 0) && (
            <Alert variant="info">
              <ListChecks />
              <span>
                Some rows need a decision. <Link href="/imports/duplicates" className="font-medium underline underline-offset-2">Review duplicates</Link> or the{" "}
                <Link href="/imports/review" className="font-medium underline underline-offset-2">review queue</Link>.
              </span>
            </Alert>
          )}
        </>
      )}
      {imp.status === "CANCELLED" && <Alert>This import was cancelled or undone — nothing from it is counted.</Alert>}
      {imp.sourceType === "PDF" && imp.status === "AWAITING_REVIEW" && imp.parseConfidence !== null && Number(imp.parseConfidence) < 90 && (
        <Alert variant="info">
          <FileWarning />
          <span>Only {Number(imp.parseConfidence).toFixed(0)}% of rows could be verified against the running balance. Check money in / out carefully — CSV or XLSX exports are more reliable.</span>
        </Alert>
      )}
      <ImportReviewTable importId={imp.id} rows={reviewRows} categories={options?.categories ?? []} editable={imp.status === "AWAITING_REVIEW"} />
    </div>
  );
}
