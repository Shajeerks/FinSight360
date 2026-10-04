"use client";
import * as React from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolveReviewAction } from "@/features/imports/actions";
import { cn } from "@/lib/utils";

export type QueueItem = { id: string; date: string; amount: string; direction: "DEBIT" | "CREDIT"; description: string; account: string; category: string | null; type: string; confidence: number | null; sources: string[]; importId: string | null; importName: string | null };

export function ReviewQueue({ items }: { items: QueueItem[] }) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, start] = React.useTransition();
  const [running, setRunning] = React.useState<"APPROVE" | "REJECT" | null>(null);
  const all = items.length > 0 && selected.size === items.length;

  function run(action: "APPROVE" | "REJECT", ids: string[]) {
    setRunning(action);
    start(async () => {
      const res = await resolveReviewAction(action, ids);
      setRunning(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Done");
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={all} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())} aria-label="Select all" />
          {selected.size ? `${selected.size} selected` : "Select all"}
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" disabled={!selected.size || pending} onClick={() => run("REJECT", [...selected])}>
            {running === "REJECT" ? <Loader2 className="animate-spin" /> : <X />} Reject
          </Button>
          <Button size="sm" disabled={!selected.size || pending} onClick={() => run("APPROVE", [...selected])}>
            {running === "APPROVE" ? <Loader2 className="animate-spin" /> : <Check />} Approve
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-3 p-4">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-[var(--primary)]"
                  checked={selected.has(t.id)}
                  aria-label={`Select ${t.description}`}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(t.id);
                      else n.delete(t.id);
                      return n;
                    })
                  }
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.date}</span>
                    <span>·</span>
                    <span className="truncate">{t.account}</span>
                    {t.confidence !== null && t.confidence < 80 && <Badge variant="warning">Confidence {t.confidence}%</Badge>}
                    <Badge variant="secondary">{t.sources.join(" + ")}</Badge>
                  </div>
                  <p className="break-words text-sm font-medium">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.type} · {t.category ?? "Uncategorized"}
                    {t.importId && (
                      <>
                        {" · "}
                        <Link className="underline-offset-2 hover:underline" href={`/imports/${t.importId}`}>{t.importName ?? "statement"}</Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <span className={cn("tabular whitespace-nowrap font-semibold", t.direction === "CREDIT" && "text-success")}>
                    {t.direction === "CREDIT" ? "+" : "−"}₹{Number(t.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="size-8" aria-label="Reject" disabled={pending} onClick={() => run("REJECT", [t.id])}><X /></Button>
                    <Button size="icon" variant="ghost" className="size-8 text-success" aria-label="Approve" disabled={pending} onClick={() => run("APPROVE", [t.id])}><Check /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
