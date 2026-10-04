"use client";
import * as React from "react";
import { Check, CopyCheck, GitMerge, Loader2, ScanSearch, Split, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveDuplicateAction, scanDuplicatesAction } from "@/features/imports/actions";
import { cn } from "@/lib/utils";

export type PairSide = { id: string; date: string; amount: string; direction: "DEBIT" | "CREDIT"; description: string; merchant: string | null; account: string; category: string | null; status: string; sources: string[]; reference: string | null };
export type Pair = { id: string; score: number; matchedFields: string[]; newer: PairSide; original: PairSide };

function Side({ s, label, highlight }: { s: PairSide; label: string; highlight: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-lg border p-3", highlight && "border-warning/50 bg-warning/5")}>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="break-words font-medium">{s.description}</p>
      <p className="tabular mt-1 text-lg font-semibold">{s.direction === "CREDIT" ? "+" : "−"}₹{Number(s.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Date</dt><dd>{s.date}</dd>
        <dt className="text-muted-foreground">Account</dt><dd className="truncate">{s.account}</dd>
        {s.merchant && (<><dt className="text-muted-foreground">Merchant</dt><dd className="truncate">{s.merchant}</dd></>)}
        {s.reference && (<><dt className="text-muted-foreground">Ref</dt><dd className="truncate">{s.reference}</dd></>)}
        <dt className="text-muted-foreground">Category</dt><dd>{s.category ?? "Uncategorized"}</dd>
        <dt className="text-muted-foreground">Source</dt><dd>{s.sources.join(" + ")}</dd>
      </dl>
    </div>
  );
}

export function DuplicatePairs({ pairs }: { pairs: Pair[] }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [, start] = React.useTransition();

  function act(id: string, action: string) {
    setBusy(`${id}:${action}`);
    start(async () => {
      const res = await resolveDuplicateAction(id, action);
      setBusy(null);
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {pairs.map((p) => (
        <Card key={p.id}>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base"><CopyCheck className="size-4 text-warning" /> Possible duplicate</CardTitle>
            <Badge variant={p.score >= 85 ? "warning" : "secondary"}>Match score {p.score}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Side s={p.newer} label="New (not counted yet)" highlight />
              <Side s={p.original} label="Already in your ledger" highlight={false} />
            </div>
            {p.matchedFields.length > 0 && <p className="text-xs text-muted-foreground">Matched on: {p.matchedFields.join(", ")}</p>}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              {[
                ["MERGE", "Merge", GitMerge, "default", "Same transaction — combine sources into the original"],
                ["CONFIRM_DUPLICATE", "Is duplicate", Check, "outline", "Same transaction — hide the new one"],
                ["KEEP_BOTH", "Keep both", Split, "outline", "Different transactions — count both"],
                ["IGNORE", "Ignore", X, "ghost", "Dismiss the warning; keep it pending in the review queue"],
              ].map(([action, label, Icon, variant, title]) => {
                const I = Icon as typeof Check;
                return (
                  <Button key={action as string} title={title as string} variant={variant as "default"} disabled={busy !== null} onClick={() => act(p.id, action as string)}>
                    {busy === `${p.id}:${action}` ? <Loader2 className="animate-spin" /> : <I />} {label as string}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ScanDuplicatesButton() {
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await scanDuplicatesAction();
          if (!res.ok) return void toast.error(res.error);
          toast.success(res.data!.flagged ? `Found ${res.data!.flagged} possible duplicate(s).` : `No new duplicates among ${res.data!.scanned} recent transactions.`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ScanSearch />} Scan for duplicates
    </Button>
  );
}
