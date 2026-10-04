import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Copy, Inbox, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { SOURCE_LABELS, TYPE_LABELS } from "@/lib/transactions/kinds";
import type { TransactionFormOptions, TransactionRow } from "@/services/transaction.service";
import { TransactionRowActions } from "@/features/transactions/transaction-dialog";
import { cn } from "@/lib/utils";

function accountLabel(t: TransactionRow) {
  if (t.transactionType === "CARD_PAYMENT" && t.creditCard) {
    const from = t.bankAccount?.nickname ?? t.cashAccount?.name ?? "";
    return `${from} → ${t.creditCard.bankName} ••${t.creditCard.last4}`;
  }
  if (t.creditCard) return `${t.creditCard.bankName} ${t.creditCard.cardName} ••${t.creditCard.last4}`;
  if (t.bankAccount) return `${t.bankAccount.nickname}${t.bankAccount.last4 ? ` ••${t.bankAccount.last4}` : ""}`;
  if (t.cashAccount) return `${t.cashAccount.name} (cash)`;
  return "—";
}

function Amount({ t }: { t: TransactionRow }) {
  const credit = t.direction === "CREDIT";
  const neutral = t.transactionType === "TRANSFER" || t.transactionType === "CARD_PAYMENT";
  return (
    <span className={cn("tabular whitespace-nowrap font-semibold", neutral ? "text-foreground" : credit ? "text-success" : "text-foreground")}>
      {credit ? "+" : "−"}
      {formatMoney(t.amount).replace("-", "")}
    </span>
  );
}

function Flags({ t }: { t: TransactionRow }) {
  return (
    <>
      {t.status === "PENDING_REVIEW" && <Badge variant="warning">Needs review</Badge>}
      {t.status === "REJECTED" && <Badge variant="secondary">Rejected</Badge>}
      {t.duplicateStatus === "POSSIBLE_DUPLICATE" && <Badge variant="warning"><Copy /> Possible duplicate</Badge>}
      {(t.duplicateStatus === "DUPLICATE" || t.duplicateOfId) && <Badge variant="secondary"><Copy /> Duplicate · not counted</Badge>}
      {t.sourceType !== "MANUAL" && <Badge variant="outline">{SOURCE_LABELS[t.sourceType]}</Badge>}
      {t._count.sources > 1 && <Badge variant="outline">{t._count.sources} sources</Badge>}
      {(t.income?.isRecurring || t.expense?.isRecurring) && <Badge variant="secondary"><Repeat /> Recurring</Badge>}
    </>
  );
}

function Icon({ t }: { t: TransactionRow }) {
  const I = t.transactionType === "TRANSFER" || t.transactionType === "CARD_PAYMENT" ? ArrowLeftRight : t.direction === "CREDIT" ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full"
      style={{ background: `${t.category?.color ?? "#94a3b8"}22`, color: t.category?.color ?? "#64748b" }}
    >
      <I className="size-4" />
    </span>
  );
}

export function TransactionList({
  rows,
  options,
  emptyTitle = "No transactions yet",
  emptyDescription = "Add your first transaction, or adjust the filters.",
  emptyAction,
}: {
  rows: TransactionRow[];
  options: TransactionFormOptions;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
}) {
  if (!rows.length) return <EmptyState icon={Inbox} title={emptyTitle} description={emptyDescription} action={emptyAction} />;

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="w-24 px-2 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((t) => (
              <tr key={t.id} className={cn("align-top hover:bg-muted/30", (t.duplicateOfId || t.status === "REJECTED") && "opacity-60")}>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(t.transactionDate)}</td>
                <td className="max-w-80 px-4 py-3">
                  <p className="truncate font-medium" title={t.description}>{t.merchantName ?? t.description}</p>
                  <p className="truncate text-xs text-muted-foreground" title={t.description}>
                    {t.merchantName ? t.description : TYPE_LABELS[t.transactionType]}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1"><Flags t={t} /></div>
                </td>
                <td className="px-4 py-3">
                  {t.category ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: t.category.color ?? "#94a3b8" }} />
                      {t.category.name}
                      {t.subCategory && <span className="text-muted-foreground">· {t.subCategory.name}</span>}
                    </span>
                  ) : (
                    <Badge variant="outline">Uncategorized</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{accountLabel(t)}</td>
                <td className="px-4 py-3 text-right"><Amount t={t} /></td>
                <td className="px-2 py-2"><TransactionRowActions id={t.id} options={options} label={t.description} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: cards */}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card md:hidden">
        {rows.map((t) => (
          <li key={t.id} className={cn("flex gap-3 p-3", (t.duplicateOfId || t.status === "REJECTED") && "opacity-60")}>
            <Icon t={t} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-medium">{t.merchantName ?? t.description}</p>
                <Amount t={t} />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {formatDate(t.transactionDate)} · {t.category?.name ?? "Uncategorized"}{t.subCategory ? ` · ${t.subCategory.name}` : ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">{accountLabel(t)}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-1">
                <div className="flex flex-wrap gap-1"><Flags t={t} /></div>
                <TransactionRowActions id={t.id} options={options} label={t.description} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({ page, pages, total, makeHref }: { page: number; pages: number; total: number; makeHref: (page: number) => string }) {
  if (pages <= 1) return <p className="text-center text-xs text-muted-foreground">{total} transaction{total === 1 ? "" : "s"}</p>;
  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
      <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "pointer-events-none opacity-50")}>
        <Link href={makeHref(page - 1)} aria-disabled={page <= 1}>Previous</Link>
      </Button>
      <span className="text-sm text-muted-foreground">Page {page} of {pages} · {total} total</span>
      <Button asChild variant="outline" size="sm" className={cn(page >= pages && "pointer-events-none opacity-50")}>
        <Link href={makeHref(page + 1)} aria-disabled={page >= pages}>Next</Link>
      </Button>
    </nav>
  );
}
