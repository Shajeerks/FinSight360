import Link from "next/link";
import { Filter, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select-native";
import { SOURCE_LABELS, TYPE_LABELS } from "@/lib/transactions/kinds";
import type { TransactionFilters } from "@/validators/transactions";
import type { TransactionFormOptions } from "@/services/transaction.service";

const ADVANCED: (keyof TransactionFilters)[] = ["category", "subCategory", "merchant", "min", "max", "type", "direction", "source", "duplicate", "origin", "status"];

/** Plain GET form → works without JavaScript and keeps filters in the URL (shareable, back-button friendly). */
export function TransactionFiltersBar({ filters, options, action = "/transactions" }: { filters: TransactionFilters; options: TransactionFormOptions; action?: string }) {
  const advancedOpen = ADVANCED.some((k) => filters[k] !== undefined);
  const selectedCat = options.categories.find((c) => c.id === filters.category);
  const v = (k: keyof TransactionFilters) => (filters[k] === undefined ? "" : String(filters[k]));
  return (
    <form method="get" action={action} className="grid gap-3 rounded-xl border bg-card p-3 sm:p-4" role="search" aria-label="Filter transactions">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1.5fr_auto]">
        <div className="relative">
          <Label htmlFor="q" className="sr-only">Search</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="q" name="q" defaultValue={v("q")} placeholder="Search description, merchant, notes, reference" className="pl-9" />
        </div>
        <div>
          <Label htmlFor="from" className="sr-only">From date</Label>
          <Input id="from" name="from" type="date" defaultValue={v("from")} aria-label="From date" />
        </div>
        <div>
          <Label htmlFor="to" className="sr-only">To date</Label>
          <Input id="to" name="to" type="date" defaultValue={v("to")} aria-label="To date" />
        </div>
        <div>
          <Label htmlFor="account" className="sr-only">Account or card</Label>
          <NativeSelect id="account" name="account" defaultValue={v("account")}>
            <option value="">All accounts & cards</option>
            {options.accounts.map((a) => (
              <option key={a.ref} value={a.ref}>{a.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 lg:flex-none"><Filter /> Apply</Button>
          <Button asChild variant="ghost"><Link href={action}>Clear</Link></Button>
        </div>
      </div>

      <details open={advancedOpen} className="group">
        <summary className="cursor-pointer select-none text-sm font-medium text-primary">More filters</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="category">Category</Label>
            <NativeSelect id="category" name="category" defaultValue={v("category")}>
              <option value="">Any</option>
              <option value="none">Uncategorized</option>
              {options.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.kind === "INCOME" ? " (income)" : ""}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="subCategory">Sub-category</Label>
            <NativeSelect id="subCategory" name="subCategory" defaultValue={v("subCategory")} disabled={!selectedCat}>
              <option value="">{selectedCat ? "Any" : "Pick a category first"}</option>
              {selectedCat?.subCategories.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="merchant">Merchant</Label>
            <Input id="merchant" name="merchant" defaultValue={v("merchant")} placeholder="e.g. Swiggy" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="min">Min ₹</Label>
              <Input id="min" name="min" inputMode="decimal" defaultValue={v("min")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="max">Max ₹</Label>
              <Input id="max" name="max" inputMode="decimal" defaultValue={v("max")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="type">Transaction type</Label>
            <NativeSelect id="type" name="type" defaultValue={v("type")}>
              <option value="">Any</option>
              {Object.entries(TYPE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="direction">Money in / out</Label>
            <NativeSelect id="direction" name="direction" defaultValue={v("direction")}>
              <option value="">Both</option>
              <option value="CREDIT">Money in (credit)</option>
              <option value="DEBIT">Money out (debit)</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="source">Source</Label>
            <NativeSelect id="source" name="source" defaultValue={v("source")}>
              <option value="">Any</option>
              {Object.entries(SOURCE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="origin">Imported / manual</Label>
            <NativeSelect id="origin" name="origin" defaultValue={v("origin")}>
              <option value="">Both</option>
              <option value="manual">Manual entries</option>
              <option value="imported">Imported</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="duplicate">Duplicate status</Label>
            <NativeSelect id="duplicate" name="duplicate" defaultValue={v("duplicate")}>
              <option value="">Any</option>
              <option value="UNIQUE">Unique</option>
              <option value="NOT_CHECKED">Not checked</option>
              <option value="POSSIBLE_DUPLICATE">Possible duplicate</option>
              <option value="DUPLICATE">Duplicate</option>
              <option value="MERGED">Merged</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="status">Review status</Label>
            <NativeSelect id="status" name="status" defaultValue={v("status")}>
              <option value="">Any</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PENDING_REVIEW">Needs review</option>
              <option value="REJECTED">Rejected</option>
            </NativeSelect>
          </div>
        </div>
      </details>
    </form>
  );
}
