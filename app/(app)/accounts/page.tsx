import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { accountsSummary } from "@/services/account.service";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BankAccountDialog, CashAccountDialog } from "@/features/accounts/account-forms";
import { DeleteAccountButton } from "@/features/accounts/delete-buttons";

export const metadata: Metadata = { title: "Bank Accounts" };

const TYPE: Record<string, string> = { SAVINGS: "Savings", CURRENT: "Current", SALARY: "Salary", OTHER: "Other" };

export default async function AccountsPage() {
  const user = await requireUser();
  const s = await accountsSummary(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Accounts"
        description="Balances update automatically from your transactions."
        actions={<><CashAccountDialog /><BankAccountDialog /></>}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground sm:text-sm">Total in bank accounts</p>
            <p className="tabular text-xl font-semibold sm:text-2xl">{formatMoney(s.totalBank, { decimals: 0 })}</p>
            <p className="text-xs text-muted-foreground">{s.banks.filter((b) => b.status !== "CLOSED").length} active account(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground sm:text-sm">Cash in hand</p>
            <p className="tabular text-xl font-semibold sm:text-2xl">{formatMoney(s.totalCash, { decimals: 0 })}</p>
            <p className="text-xs text-muted-foreground">{s.cash.length} wallet(s)</p>
          </CardContent>
        </Card>
      </div>

      {s.banks.length === 0 ? (
        <EmptyState icon={Landmark} title="No bank accounts yet" description="Add your savings, salary or current accounts. Only the last four digits are stored." action={<BankAccountDialog />} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {s.banks.map((a) => (
            <Card key={a.id} className={a.status === "CLOSED" ? "opacity-60" : undefined}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Landmark className="size-5" /></span>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{a.nickname}</CardTitle>
                    <CardDescription className="truncate">{a.bankName}{a.last4 ? ` · ••${a.last4}` : ""}</CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant="secondary">{TYPE[a.accountType]}</Badge>
                  {a.status !== "ACTIVE" && <Badge variant="outline">{a.status.toLowerCase()}</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Current balance</p>
                  <p className={`tabular text-2xl font-semibold ${a.currentBalance.isNegative() ? "text-destructive" : ""}`}>{formatMoney(a.currentBalance)}</p>
                  <p className="text-xs text-muted-foreground">Opening {formatMoney(a.openingBalance, { decimals: 0 })} · {a.transactionCount} transaction(s) · added {formatDate(a.createdAt)}</p>
                </div>
                {a.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{a.notes}</p>}
                <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                  <Button asChild variant="ghost" size="sm"><Link href={`/transactions?account=bank:${a.id}`}>Transactions</Link></Button>
                  <BankAccountDialog
                    trigger="edit"
                    id={a.id}
                    defaults={{ bankName: a.bankName, nickname: a.nickname, accountType: a.accountType, last4: a.last4 ?? "", currentBalance: a.currentBalance.toFixed(2), status: a.status, notes: a.notes ?? "" }}
                  />
                  <DeleteAccountButton id={a.id} kind="bank" name={a.nickname} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Cash wallets</h2>
        {s.cash.length === 0 ? (
          <p className="text-sm text-muted-foreground">Track cash spending by adding a wallet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {s.cash.map((c) => (
              <Card key={c.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Wallet className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="tabular text-lg font-semibold">{formatMoney(c.currentBalance)}</p>
                  </div>
                  <div className="flex flex-col items-end">
                    <CashAccountDialog trigger="edit" id={c.id} defaults={{ name: c.name, currentBalance: c.currentBalance.toFixed(2), status: c.status, notes: c.notes ?? "" }} />
                    <DeleteAccountButton id={c.id} kind="cash" name={c.name} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
