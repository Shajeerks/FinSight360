import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getTransactionFormOptions, listTransactions } from "@/services/transaction.service";
import { parseTransactionFilters } from "@/validators/transactions";
import { TransactionFiltersBar } from "@/features/transactions/transaction-filters";
import { Pagination, TransactionList } from "@/features/transactions/transaction-list";
import { AddTransactionButton } from "@/features/transactions/transaction-dialog";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseTransactionFilters(sp);
  const [list, options] = await Promise.all([listTransactions(user.id, filters), getTransactionFormOptions(user.id)]);
  const net = list.totals.credit.minus(list.totals.debit);

  const makeHref = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "page") q.set(k, v);
    q.set("page", String(page));
    return `/transactions?${q.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Transactions"
        description="Every transaction from every source, in one ledger."
        actions={<AddTransactionButton options={options} label="Add Transaction" />}
      />
      <TransactionFiltersBar filters={filters} options={options} />
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Money in</p><p className="tabular text-sm font-semibold text-success sm:text-lg">{formatMoney(list.totals.credit, { decimals: 0 })}</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Money out</p><p className="tabular text-sm font-semibold sm:text-lg">{formatMoney(list.totals.debit, { decimals: 0 })}</p></CardContent></Card>
        <Card><CardContent className="p-3 sm:p-4"><p className="text-xs text-muted-foreground">Net</p><p className="tabular text-sm font-semibold sm:text-lg">{formatMoney(net, { decimals: 0 })}</p></CardContent></Card>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Totals include transfers and card payments in the filter, and exclude duplicates, rejected and pending items.</p>
      <TransactionList rows={list.rows} options={options} emptyAction={<AddTransactionButton options={options} label="Add Transaction" variant="outline" />} />
      <Pagination page={list.page} pages={list.pages} total={list.total} makeHref={makeHref} />
    </div>
  );
}
