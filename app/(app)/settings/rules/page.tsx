import type { Metadata } from "next";
import { Wand2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { listRules } from "@/services/rule.service";
import { listCategories } from "@/services/category.service";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ApplyRulesButton, DeleteRuleButton, RuleDialog, RuleToggle, type CategoryChoice } from "@/features/categories/rule-ui";

export const metadata: Metadata = { title: "Transaction Rules" };

const MATCH: Record<string, string> = { MERCHANT: "Merchant", KEYWORD: "Keyword", AMOUNT: "Amount" };

export default async function RulesPage() {
  const user = await requireUser();
  const [rules, cats] = await Promise.all([listRules(user.id), listCategories(user.id)]);
  const choices: CategoryChoice[] = cats.filter((c) => c.kind !== "TRANSFER").map((c) => ({ id: c.id, name: c.name, kind: c.kind, subCategories: c.subCategories.map((s) => ({ id: s.id, name: s.name })) }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction Rules"
        description="Automatic categorization: e.g. SWIGGY → Food → Food Delivery. Your manual choices always win."
        actions={<><ApplyRulesButton /><RuleDialog categories={choices} /></>}
      />
      {rules.length === 0 ? (
        <EmptyState icon={Wand2} title="No rules yet" description="Add a rule, or tick “apply to future transactions” when you categorize a merchant." action={<RuleDialog categories={choices} />} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {rules.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-3 p-4 ${r.isActive ? "" : "opacity-60"}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{MATCH[r.matchType]}</Badge>
                      <span className="font-mono text-sm font-medium">{r.pattern ?? "—"}</span>
                      {r.matchType === "AMOUNT" && (
                        <span className="text-xs text-muted-foreground">
                          {r.amountMin ? formatMoney(r.amountMin, { decimals: 0 }) : "any"} – {r.amountMax ? formatMoney(r.amountMax, { decimals: 0 }) : "any"}
                        </span>
                      )}
                      {r.direction && <Badge variant="secondary">{r.direction === "DEBIT" ? "Money out" : "Money in"}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      → <span className="inline-block size-2 rounded-full align-middle" style={{ background: r.category.color ?? "#94a3b8" }} /> {r.category.name}
                      {r.subCategory ? ` → ${r.subCategory.name}` : ""} · priority {r.priority}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <RuleToggle id={r.id} isActive={r.isActive} />
                    <RuleDialog
                      categories={choices}
                      trigger="edit"
                      id={r.id}
                      defaults={{
                        name: r.name, matchType: r.matchType, pattern: r.pattern ?? "", amountMin: r.amountMin?.toFixed(2) ?? "", amountMax: r.amountMax?.toFixed(2) ?? "",
                        direction: r.direction ?? "", categoryId: r.categoryId, subCategoryId: r.subCategoryId ?? "", priority: r.priority, isActive: r.isActive,
                      }}
                    />
                    <DeleteRuleButton id={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
