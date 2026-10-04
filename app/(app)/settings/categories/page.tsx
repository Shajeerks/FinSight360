import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { listCategories } from "@/services/category.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddSubCategoryInline, CategoryDialog, DeleteCategoryButton, SubCategoryChip } from "@/features/categories/category-ui";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requireUser();
  const cats = await listCategories(user.id);
  const groups = [
    { title: "Expense categories", items: cats.filter((c) => c.kind === "EXPENSE") },
    { title: "Income categories", items: cats.filter((c) => c.kind === "INCOME") },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Built-in categories plus your own. Add sub-categories anywhere." actions={<CategoryDialog />} />
      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-lg font-semibold">{g.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {g.items.map((c) => {
              const mine = c.userId === user.id;
              return (
                <Card key={c.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center gap-2">
                      <span className="size-3 rounded-full" style={{ background: c.color ?? "#94a3b8" }} />
                      <p className="flex-1 font-medium">{c.name}</p>
                      {c.isFixed && <Badge variant="secondary">Fixed</Badge>}
                      {mine ? (
                        <>
                          <Badge variant="default">Yours</Badge>
                          <CategoryDialog trigger="edit" id={c.id} defaults={{ name: c.name, kind: c.kind === "INCOME" ? "INCOME" : "EXPENSE", color: c.color ?? "#64748b", isFixed: c.isFixed }} />
                          <DeleteCategoryButton id={c.id} name={c.name} />
                        </>
                      ) : (
                        <Badge variant="outline">Built-in</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {c.subCategories.map((s) => <SubCategoryChip key={s.id} id={s.id} name={s.name} removable={s.userId === user.id} />)}
                      {!c.subCategories.length && <span className="text-xs text-muted-foreground">No sub-categories</span>}
                    </div>
                    <AddSubCategoryInline categoryId={c.id} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
