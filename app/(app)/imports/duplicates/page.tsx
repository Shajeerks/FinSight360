import type { Metadata } from "next";
import { CopyCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listDuplicateCandidates, type DuplicatePair } from "@/services/duplicate.service";
import { SOURCE_LABELS, TYPE_LABELS } from "@/lib/transactions/kinds";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DuplicatePairs, ScanDuplicatesButton, type Pair, type PairSide } from "@/features/imports/duplicate-pairs";
import { accountLabelOf } from "@/features/imports/labels";

export const metadata: Metadata = { title: "Review Duplicates" };

function side(t: DuplicatePair["transaction"]): PairSide {
  return {
    id: t.id,
    date: t.transactionDate.toISOString().slice(0, 10),
    amount: t.amount.toFixed(2),
    direction: t.direction,
    description: t.description,
    merchant: t.merchantName,
    account: accountLabelOf(t),
    category: t.category?.name ?? (t.transactionType !== "EXPENSE" ? TYPE_LABELS[t.transactionType] : null),
    status: t.status,
    sources: [...new Set(t.sources.map((s) => SOURCE_LABELS[s.sourceType] ?? s.sourceType))],
    reference: t.referenceNumber,
  };
}

export default async function DuplicatesPage() {
  const user = await requireUser();
  const candidates = await listDuplicateCandidates(user.id);
  const pairs: Pair[] = candidates.map((c) => ({ id: c.id, score: Number(c.score), matchedFields: c.matchedFields, newer: side(c.transaction), original: side(c.matchedTransaction) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review Duplicates"
        description="The same transaction can arrive from an email, a statement and manual entry. Decide once — it's then counted exactly once."
        actions={<ScanDuplicatesButton />}
      />
      {pairs.length === 0 ? (
        <EmptyState icon={CopyCheck} title="No possible duplicates" description="Statement rows that exactly match your existing transactions are linked automatically. Anything uncertain will show up here." />
      ) : (
        <DuplicatePairs pairs={pairs} />
      )}
    </div>
  );
}
