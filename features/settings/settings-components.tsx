"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { preferencesSchema, templateRenameSchema, type PreferencesInput, type TemplateRenameInput } from "@/validators/settings";
import { deleteTemplateAction, renameTemplateAction, savePreferencesAction, unlinkMethodAction } from "@/features/settings/settings-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/ui/confirm-button";

const COMMON_TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export function PreferencesForm({ defaults }: { defaults: PreferencesInput }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const form = useForm<PreferencesInput, unknown, z.output<typeof preferencesSchema>>({ resolver: zodResolver(preferencesSchema), defaultValues: defaults });
  const { errors, isDirty } = form.formState;
  const tzOptions = COMMON_TIMEZONES.includes(String(defaults.timezone)) ? COMMON_TIMEZONES : [String(defaults.timezone), ...COMMON_TIMEZONES];
  const submit = form.handleSubmit(() =>
    start(async () => {
      const res = await savePreferencesAction(form.getValues());
      if (!res.ok) {
        toast.error(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof PreferencesInput, { message: v[0] });
        return;
      }
      toast.success(res.message ?? "Saved");
      form.reset(form.getValues());
      router.refresh();
    }),
  );
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="currency" label="Currency" hint="Amounts are shown in Indian Rupees." error={errors.currency?.message}>
          <NativeSelect id="currency" {...form.register("currency")}>
            <option value="INR">INR — Indian Rupee (₹)</option>
          </NativeSelect>
        </FormField>
        <FormField id="timezone" label="Timezone" hint="Decides which day and month a transaction falls in." error={errors.timezone?.message}>
          <NativeSelect id="timezone" {...form.register("timezone")}>
            {tzOptions.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </NativeSelect>
        </FormField>
        <FormField id="cardUtilizationAlertPct" label="Card utilization alert (%)" hint="Warn when a card's usage goes above this share of its limit." error={errors.cardUtilizationAlertPct?.message}>
          <Input id="cardUtilizationAlertPct" type="number" inputMode="numeric" min={1} max={100} step={1} {...form.register("cardUtilizationAlertPct")} />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !isDirty}>{pending && <Loader2 className="animate-spin" />}Save</Button>
      </div>
    </form>
  );
}

export function TemplateActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const form = useForm<TemplateRenameInput, unknown, z.output<typeof templateRenameSchema>>({ resolver: zodResolver(templateRenameSchema), defaultValues: { name } });
  const submit = form.handleSubmit(() =>
    start(async () => {
      const res = await renameTemplateAction(id, form.getValues());
      if (!res.ok) {
        form.setError("name", { message: res.fieldErrors?.name?.[0] ?? res.error });
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      router.refresh();
    }),
  );
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) form.reset({ name }); }}>
        <Button size="icon" variant="ghost" className="size-8" aria-label={`Rename ${name}`} onClick={() => setOpen(true)}><Pencil /></Button>
        <DialogContent title="Rename template" description="The new name appears when you map a statement.">
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <FormField id={`tpl-${id}`} label="Template name" error={form.formState.errors.name?.message}>
              <Input id={`tpl-${id}`} {...form.register("name")} />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmButton
        size="icon"
        className="size-8 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${name}`}
        title={`Delete "${name}"?`}
        description="Statements you already imported with it are not affected. Next time you upload this bank's file you'll map the columns again."
        onConfirm={async () => {
          const res = await deleteTemplateAction(id);
          if (res.ok) router.refresh();
          return res;
        }}
      >
        <Trash2 />
      </ConfirmButton>
    </div>
  );
}

export function UnlinkMethodButton({ provider, label }: { provider: string; label: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      variant="outline"
      size="sm"
      title={`Remove ${label} sign-in?`}
      description={`You won't be able to sign in with ${label} any more. Your data isn't affected, and you can add it again later.`}
      confirmLabel="Remove"
      onConfirm={async () => {
        const res = await unlinkMethodAction(provider);
        if (res.ok) router.refresh();
        return res;
      }}
    >
      <Unlink /> Remove
    </ConfirmButton>
  );
}
