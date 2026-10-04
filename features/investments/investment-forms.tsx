"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, IndianRupee, Loader2, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { ActionResult } from "@/lib/errors";
import {
  addInvestmentTxnAction, deleteHoldingAction, deleteInvestmentAccountAction, deleteInvestmentTxnAction, refreshNavsAction, saveHoldingAction, saveInvestmentAccountAction, updatePriceAction,
} from "@/features/investments/actions";

export const INSTRUMENT_LABEL: Record<string, string> = { MUTUAL_FUND: "Mutual fund", STOCK: "Stock", ETF: "ETF", BOND: "Bond", FIXED_DEPOSIT: "Fixed deposit", GOLD: "Gold", OTHER: "Other" };
export const TXN_LABEL: Record<string, string> = { BUY: "Buy", SIP: "SIP", SELL: "Sell", REDEMPTION: "Redemption", DIVIDEND: "Dividend", SWITCH_IN: "Switch in", SWITCH_OUT: "Switch out", BONUS: "Bonus units", SPLIT: "Split (extra units)" };

type Errors = Record<string, string[]>;
type AccountOpt = { id: string; name: string; holdings: { id: string; instrumentName: string; instrumentType: string }[] };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** Small helper: run a server action, show toast, keep field errors. */
function useSubmit<T>(onDone?: (res: ActionResult<T>) => void) {
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Errors>({});
  const [error, setError] = React.useState<string | null>(null);
  const run = (fn: () => Promise<ActionResult<T>>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        if (res.fieldErrors) toast.error(res.error);
        return;
      }
      setErrors({});
      toast.success(res.message ?? "Saved");
      onDone?.(res);
    });
  return { pending, errors, error, run };
}

// ───────────────────────── account ─────────────────────────

export function InvestmentAccountDialog({ account, trigger }: { account?: { id: string; name: string; providerType: string; accountType: string }; trigger?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: account?.name ?? "", providerType: account?.providerType ?? "GROWW", accountType: account?.accountType ?? "DEMAT" });
  const { pending, errors, error, run } = useSubmit(() => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : <Button onClick={() => setOpen(true)}><Plus /> Add account</Button>}
      <DialogContent title={account ? "Edit investment account" : "Add investment account"} description="A demat, mutual-fund or broker account. No login details are ever needed.">
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); run(() => saveInvestmentAccountAction(account?.id ?? null, v)); }}>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="ia-name" label="Name" error={errors.name?.[0]}><Input id="ia-name" placeholder="e.g. Groww stocks" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="ia-provider" label="Platform">
              <NativeSelect id="ia-provider" value={v.providerType} onChange={(e) => setV({ ...v, providerType: e.target.value })}>
                <option value="GROWW">Groww</option><option value="MANUAL">Manual / other</option><option value="OTHER">Other broker</option>
              </NativeSelect>
            </FormField>
            <FormField id="ia-type" label="Type">
              <NativeSelect id="ia-type" value={v.accountType} onChange={(e) => setV({ ...v, accountType: e.target.value })}>
                <option value="DEMAT">Demat (stocks / ETFs)</option><option value="MUTUAL_FUND">Mutual funds</option><option value="BROKERAGE">Brokerage</option><option value="OTHER">Other</option>
              </NativeSelect>
            </FormField>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{account ? "Save" : "Add account"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteInvestmentAccountButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmButton size="sm" className="text-muted-foreground hover:text-destructive" title={`Remove ${name}?`} description="Its holdings and history are hidden and no longer count in your net worth." confirmLabel="Remove" onConfirm={() => deleteInvestmentAccountAction(id)}>
      <Trash2 /> Remove
    </ConfirmButton>
  );
}

// ───────────────────────── holding (snapshot) ─────────────────────────

type HoldingValues = { instrumentName: string; instrumentType: string; isin: string; symbol: string; quantity: string; averageBuyPrice: string; investedAmount: string; currentPrice: string };

export function HoldingDialog({ accounts, holding, hasTransactions, trigger }: { accounts: AccountOpt[]; holding?: HoldingValues & { id: string; investmentAccountId: string }; hasTransactions?: boolean; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [accountId, setAccountId] = React.useState(holding?.investmentAccountId ?? accounts[0]?.id ?? "");
  const [v, setV] = React.useState<HoldingValues>(holding ?? { instrumentName: "", instrumentType: "MUTUAL_FUND", isin: "", symbol: "", quantity: "", averageBuyPrice: "", investedAmount: "", currentPrice: "" });
  const { pending, errors, error, run } = useSubmit<{ id: string }>((res) => {
    setOpen(false);
    if (!holding && res.ok && res.data) router.push(`/investments/${res.data.id}`);
  });
  const set = (k: keyof HoldingValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const locked = Boolean(hasTransactions);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : <Button variant="outline" onClick={() => setOpen(true)} disabled={!accounts.length}><Plus /> Add holding</Button>}
      <DialogContent title={holding ? "Edit holding" : "Add holding"} description={locked ? "Units and cost come from this holding's transactions — edit those instead." : "Enter what you hold today. Add transactions later for exact gains and XIRR."}>
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); run(() => saveHoldingAction(holding?.id ?? null, { ...v, investmentAccountId: accountId })); }}>
          {error && <Alert variant="destructive">{error}</Alert>}
          {!holding && (
            <FormField id="h-acct" label="Account" error={errors.investmentAccountId?.[0]}>
              <NativeSelect id="h-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
            </FormField>
          )}
          <FormField id="h-name" label="Fund / stock name" error={errors.instrumentName?.[0]}><Input id="h-name" value={v.instrumentName} onChange={set("instrumentName")} placeholder="e.g. Parag Parikh Flexi Cap Fund Direct Growth" /></FormField>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField id="h-type" label="Type"><NativeSelect id="h-type" value={v.instrumentType} onChange={set("instrumentType")}>{Object.entries(INSTRUMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></FormField>
            <FormField id="h-isin" label="ISIN (optional)" error={errors.isin?.[0]} hint="Needed for automatic NAVs"><Input id="h-isin" value={v.isin} onChange={set("isin")} maxLength={12} /></FormField>
            <FormField id="h-sym" label="Symbol (optional)" error={errors.symbol?.[0]}><Input id="h-sym" value={v.symbol} onChange={set("symbol")} maxLength={20} /></FormField>
          </div>
          {!locked && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="h-qty" label="Units / quantity" error={errors.quantity?.[0]}><Input id="h-qty" inputMode="decimal" value={v.quantity} onChange={set("quantity")} /></FormField>
              <FormField id="h-avg" label="Average buy price / NAV" error={errors.averageBuyPrice?.[0]}><Input id="h-avg" inputMode="decimal" value={v.averageBuyPrice} onChange={set("averageBuyPrice")} /></FormField>
              <FormField id="h-inv" label="…or total invested (₹)" error={errors.investedAmount?.[0]}><Input id="h-inv" inputMode="decimal" value={v.investedAmount} onChange={set("investedAmount")} /></FormField>
              <FormField id="h-cur" label="Current price / NAV (optional)" error={errors.currentPrice?.[0]}><Input id="h-cur" inputMode="decimal" value={v.currentPrice} onChange={set("currentPrice")} /></FormField>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{holding ? "Save" : "Add holding"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditHoldingButton(props: React.ComponentProps<typeof HoldingDialog>) {
  return <HoldingDialog {...props} trigger={<Button variant="outline" size="sm"><Pencil /> Edit</Button>} />;
}

export function DeleteHoldingButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton size="sm" className="text-muted-foreground hover:text-destructive" title={`Remove ${name}?`} description="The holding and its transactions are removed from your portfolio." confirmLabel="Remove" onConfirm={async () => {
      const res = await deleteHoldingAction(id);
      if (res.ok) router.push("/investments");
      return res;
    }}>
      <Trash2 /> Remove
    </ConfirmButton>
  );
}

export function PriceDialog({ id, current, name }: { id: string; current: string | null; name: string }) {
  const [open, setOpen] = React.useState(false);
  const [price, setPrice] = React.useState(current ?? "");
  const { pending, errors, run } = useSubmit(() => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><IndianRupee /> Update price</Button>
      <DialogContent title="Update current price" description={name}>
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); run(() => updatePriceAction(id, { currentPrice: price })); }}>
          <FormField id="p-price" label="Current price / NAV (₹)" error={errors.currentPrice?.[0]}><Input id="p-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></FormField>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save price</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── transaction ─────────────────────────

export function InvestmentTxnDialog({ accounts, holdingId, accountId: fixedAccount, label = "Add transaction" }: { accounts: AccountOpt[]; holdingId?: string; accountId?: string; label?: string }) {
  const [open, setOpen] = React.useState(false);
  const [accountId, setAccountId] = React.useState(fixedAccount ?? accounts[0]?.id ?? "");
  const [holding, setHolding] = React.useState(holdingId ?? "");
  const [v, setV] = React.useState({ instrumentName: "", instrumentType: "MUTUAL_FUND", isin: "", type: "BUY", tradeDate: today(), quantity: "", price: "", amount: "", charges: "0" });
  const { pending, errors, error, run } = useSubmit(() => setOpen(false));
  const holdings = accounts.find((a) => a.id === accountId)?.holdings ?? [];
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant={holdingId ? "default" : "outline"} size={holdingId ? "sm" : "default"} disabled={!accounts.length} onClick={() => setOpen(true)}><Plus /> {label}</Button>
      <DialogContent title="Add investment transaction" description="Buys, SIPs, sells, redemptions, dividends, bonus/split units. The holding is recalculated (average cost).">
        <form className="grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); run(() => addInvestmentTxnAction({ ...v, investmentAccountId: accountId, holdingId: holding || null })); }}>
          {error && <Alert variant="destructive">{error}</Alert>}
          {!holdingId && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="t-acct" label="Account">
                <NativeSelect id="t-acct" value={accountId} onChange={(e) => { setAccountId(e.target.value); setHolding(""); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</NativeSelect>
              </FormField>
              <FormField id="t-hold" label="Holding">
                <NativeSelect id="t-hold" value={holding} onChange={(e) => setHolding(e.target.value)}>
                  <option value="">+ New fund / stock</option>
                  {holdings.map((h) => <option key={h.id} value={h.id}>{h.instrumentName}</option>)}
                </NativeSelect>
              </FormField>
            </div>
          )}
          {!holding && (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField id="t-name" label="Fund / stock name" error={errors.instrumentName?.[0]} className="sm:col-span-3"><Input id="t-name" value={v.instrumentName} onChange={set("instrumentName")} /></FormField>
              <FormField id="t-itype" label="Type" error={errors.instrumentType?.[0]}><NativeSelect id="t-itype" value={v.instrumentType} onChange={set("instrumentType")}>{Object.entries(INSTRUMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></FormField>
              <FormField id="t-isin" label="ISIN (optional)" error={errors.isin?.[0]} className="sm:col-span-2"><Input id="t-isin" value={v.isin} onChange={set("isin")} maxLength={12} /></FormField>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="t-type" label="Transaction"><NativeSelect id="t-type" value={v.type} onChange={set("type")}>{Object.entries(TXN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></FormField>
            <FormField id="t-date" label="Date" error={errors.tradeDate?.[0]}><Input id="t-date" type="date" value={v.tradeDate} max={today()} onChange={set("tradeDate")} /></FormField>
            {v.type !== "DIVIDEND" && <FormField id="t-qty" label="Units / quantity" error={errors.quantity?.[0]}><Input id="t-qty" inputMode="decimal" value={v.quantity} onChange={set("quantity")} /></FormField>}
            {!["DIVIDEND", "BONUS", "SPLIT"].includes(v.type) && <FormField id="t-price" label="Price / NAV" error={errors.price?.[0]}><Input id="t-price" inputMode="decimal" value={v.price} onChange={set("price")} /></FormField>}
            {!["BONUS", "SPLIT"].includes(v.type) && <FormField id="t-amt" label={v.type === "DIVIDEND" ? "Dividend amount (₹)" : "Total amount (₹)"} error={errors.amount?.[0]} hint={v.type === "DIVIDEND" ? undefined : "Leave empty to use units × price"}><Input id="t-amt" inputMode="decimal" value={v.amount} onChange={set("amount")} /></FormField>}
            {!["BONUS", "SPLIT"].includes(v.type) && <FormField id="t-ch" label="Charges (₹)" error={errors.charges?.[0]}><Input id="t-ch" inputMode="decimal" value={v.charges} onChange={set("charges")} /></FormField>}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Add transaction</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteInvestmentTxnButton({ id, holdingId }: { id: string; holdingId: string }) {
  return (
    <ConfirmButton variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Delete transaction" title="Delete this transaction?" description="The holding's units, average cost and gains are recalculated." confirmLabel="Delete" onConfirm={() => deleteInvestmentTxnAction(id, holdingId)}>
      <Trash2 />
    </ConfirmButton>
  );
}

export function RefreshNavButton() {
  const [pending, start] = React.useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      const res = await refreshNavsAction();
      if (!res.ok) return void toast.error(res.error);
      const r = res.data!;
      toast.success(r.updated ? `Updated ${r.updated} fund NAV${r.updated === 1 ? "" : "s"} (as of ${r.asOf}).${r.notFound ? ` ${r.notFound} not found — check their ISIN.` : ""}` : "No mutual funds with an ISIN to update.");
    })}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refresh NAVs
    </Button>
  );
}

// ───────────────────────── Groww import ─────────────────────────

type ImportPreview = {
  kind: "HOLDINGS" | "TRANSACTIONS";
  committed: boolean;
  skipped: { row: number; reason: string }[];
  holdings: { name: string; type: string; quantity: string; invested: string; current: string | null; action: string }[];
  removed: { name: string; quantity: string }[];
  transactions: { name: string; type: string; date: string; quantity: string; amount: string; duplicate: boolean }[];
  warnings: string[];
};

const ACTION_BADGE: Record<string, React.ReactNode> = {
  NEW: <Badge variant="success">New</Badge>,
  UPDATE: <Badge variant="warning">Update</Badge>,
  PRICE_ONLY: <Badge variant="secondary">Price only</Badge>,
  UNCHANGED: <Badge variant="secondary">No change</Badge>,
};

export function GrowwImportDialog({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [removeMissing, setRemoveMissing] = React.useState(true);
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  async function send(commit: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("commit", commit ? "1" : "0");
    fd.set("removeMissing", removeMissing ? "1" : "0");
    try {
      const res = await fetch(`/api/investments/accounts/${accountId}/import`, { method: "POST", body: fd });
      const body = (await res.json().catch(() => null)) as { data?: ImportPreview; error?: { message: string } } | null;
      if (!res.ok || !body?.data) return void setError(body?.error?.message ?? "Import failed.");
      if (commit) {
        const d = body.data;
        toast.success(d.kind === "HOLDINGS" ? `Imported ${d.holdings.length} holding(s)${d.removed.length && removeMissing ? `, removed ${d.removed.length} sold` : ""}.` : `Imported ${d.transactions.filter((t) => !t.duplicate).length} transaction(s).`);
        setOpen(false);
        setPreview(null);
        setFile(null);
        router.refresh();
      } else setPreview(body.data);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const newTx = preview?.transactions.filter((t) => !t.duplicate).length ?? 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setPreview(null); setError(null); } }}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Upload /> Import from Groww</Button>
      <DialogContent title={`Import into ${accountName}`} description="Upload the XLSX/CSV you download in Groww → Reports (Holdings statement or Transactions / Order history). No Groww login or OTP is needed.">
        <div className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          <label htmlFor="g-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center hover:border-primary/50">
            <FileUp className="size-5 text-primary" />
            <span className="text-sm font-medium">{file ? file.name : "Choose the Groww report (XLSX or CSV)"}</span>
            <input id="g-file" type="file" className="sr-only" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null); }} />
          </label>
          {preview && (
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border p-3 text-sm">
              <p className="font-medium">{preview.kind === "HOLDINGS" ? `Holdings statement · ${preview.holdings.length} holding(s)` : `Order history · ${newTx} new, ${preview.transactions.length - newTx} already imported`}</p>
              {preview.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-warning">{w}</p>)}
              <ul className="divide-y">
                {preview.holdings.map((h) => (
                  <li key={h.name} className="flex items-center justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{h.name}</span><span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{h.quantity} u {ACTION_BADGE[h.action]}</span></li>
                ))}
                {preview.transactions.slice(0, 100).map((t, i) => (
                  <li key={i} className={`flex items-center justify-between gap-2 py-1.5 ${t.duplicate ? "opacity-50" : ""}`}><span className="min-w-0 truncate">{t.date} · {TXN_LABEL[t.type] ?? t.type} · {t.name}</span><span className="shrink-0 text-xs tabular">₹{t.amount}{t.duplicate ? " (already in)" : ""}</span></li>
                ))}
              </ul>
              {preview.removed.length > 0 && (
                <CheckboxField id="g-remove" label={`Remove ${preview.removed.length} holding(s) not in this statement`} hint={preview.removed.map((r) => r.name).join(", ")} checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} />
              )}
              {preview.skipped.length > 0 && <p className="text-xs text-muted-foreground">{preview.skipped.length} row(s) skipped: {preview.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join(", ")}{preview.skipped.length > 3 ? "…" : ""}</p>}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            {!preview ? (
              <Button disabled={!file || busy} onClick={() => send(false)}>{busy && <Loader2 className="animate-spin" />}Preview</Button>
            ) : (
              <Button disabled={busy || (preview.kind === "TRANSACTIONS" && newTx === 0)} onClick={() => send(true)}>{busy && <Loader2 className="animate-spin" />}Import</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
