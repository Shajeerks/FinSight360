import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listReviewQueue } from "@/services/duplicate.service";
import { SOURCE_LABELS, TYPE_LABELS } from "@/lib/transactions/kinds";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ReviewQueue, type QueueItem } from "@/features/imports/review-queue";
import { accountLabelOf } from "@/features/imports/labels";

export const metadata: Metadata = { title: "Review Queue" };

export default async function ReviewPage() {
  const user = await requireUser();
  const rows = await listReviewQueue(user.id);
  const items: QueueItem[] = rows.map((t) => ({
    id: t.id,
    date: t.transactionDate.toISOString().slice(0, 10),
    amount: t.amount.toFixed(2),
    direction: t.direction,
    description: t.description,
    account: accountLabelOf(t),
    category: t.category?.name ?? null,
    type: TYPE_LABELS[t.transactionType] ?? t.transactionType,
    confidence: t.confidenceScore === null ? null : Number(t.confidenceScore),
    sources: [...new Set(t.sources.map((s) => SOURCE_LABELS[s.sourceType] ?? s.sourceType))],
    importId: t.import?.id ?? null,
    importName: t.import?.fileName ?? null,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Queue"
        description="Imported transactions we weren't fully sure about. They don't count in totals or balances until you approve them. To change a category first, edit it from Transactions."
      />
      {items.length === 0 ? (
        <EmptyState icon={ListChecks} title="All caught up" description="Nothing is waiting for approval." />
      ) : (
        <ReviewQueue items={items} />
      )}
    </div>
  );
}
