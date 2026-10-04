"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { categorySchema, type CategoryInput } from "@/validators/transactions";
import { addSubCategoryAction, deleteCategoryAction, deleteSubCategoryAction, saveCategoryAction } from "@/features/categories/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";

export function CategoryDialog({ id = null, defaults, trigger = "add" }: { id?: string | null; defaults?: Partial<CategoryInput>; trigger?: "add" | "edit" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CategoryInput, unknown, z.output<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", kind: "EXPENSE", color: "#6366f1", isFixed: false, ...defaults },
  });
  const submit = form.handleSubmit(() =>
    start(async () => {
      setError(null);
      const res = await saveCategoryAction(id, form.getValues());
      if (!res.ok) {
        setError(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof CategoryInput, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      form.reset();
      router.refresh();
    }),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === "add" ? (
        <Button onClick={() => setOpen(true)}><Plus /> Add category</Button>
      ) : (
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpen(true)} aria-label="Edit category"><Pencil /></Button>
      )}
      <DialogContent title={id ? "Edit category" : "Add category"}>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert variant="destructive">{error}</Alert>}
          <FormField id="cat-name" label="Name" error={form.formState.errors.name?.message}>
            <Input id="cat-name" {...form.register("name")} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="cat-kind" label="Type">
              <NativeSelect id="cat-kind" disabled={Boolean(id)} {...form.register("kind")}>
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
              </NativeSelect>
            </FormField>
            <FormField id="cat-color" label="Colour" error={form.formState.errors.color?.message}>
              <Input id="cat-color" type="color" className="h-11 p-1" {...form.register("color")} />
            </FormField>
          </div>
          <CheckboxField id="cat-fixed" label="Fixed cost" hint="Rent, bills, insurance — used to split fixed vs discretionary spending." {...form.register("isFixed")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteCategoryButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmButton
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground hover:text-destructive"
      aria-label={`Delete ${name}`}
      title={`Delete “${name}”?`}
      description="Existing transactions keep this category for history. Rules using it are paused."
      onConfirm={() => deleteCategoryAction(id)}
    >
      <Trash2 />
    </ConfirmButton>
  );
}

export function AddSubCategoryInline({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [pending, start] = React.useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addSubCategoryAction({ categoryId, name });
          if (!res.ok) return void toast.error(res.fieldErrors?.name?.[0] ?? res.error);
          toast.success(res.message ?? "Added");
          setName("");
          router.refresh();
        });
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New sub-category" className="h-9 md:h-9" aria-label="New sub-category name" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || name.trim().length < 2}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
      </Button>
    </form>
  );
}

export function SubCategoryChip({ id, name, removable }: { id: string; name: string; removable: boolean }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs">
      {name}
      {removable ? (
        <button
          type="button"
          disabled={pending}
          className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${name}`}
          onClick={() =>
            start(async () => {
              const res = await deleteSubCategoryAction(id);
              if (!res.ok) toast.error(res.error);
              else router.refresh();
            })
          }
        >
          <X className="size-3" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}
