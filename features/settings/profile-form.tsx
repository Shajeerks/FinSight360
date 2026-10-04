"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { profileSchema, type ProfileInput } from "@/validators/profile";
import { updateProfileAction } from "@/features/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/select-native";

const COMMON_TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export function ProfileForm({ defaults, email }: { defaults: ProfileInput; email: string }) {
  const [pending, startTransition] = React.useTransition();
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const { errors, isDirty } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await updateProfileAction(values);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        form.reset(values);
      } else {
        toast.error(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof ProfileInput, { message: v[0] });
      }
    }),
  );

  const tzOptions = COMMON_TIMEZONES.includes(String(defaults.timezone)) ? COMMON_TIMEZONES : [String(defaults.timezone), ...COMMON_TIMEZONES];

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="name" label="Full name" error={errors.name?.message}>
          <Input id="name" autoComplete="name" {...form.register("name")} />
        </FormField>
        <FormField id="displayName" label="Display name" hint="Optional — shown in greetings" error={errors.displayName?.message}>
          <Input id="displayName" {...form.register("displayName")} />
        </FormField>
        <FormField id="email" label="Email" hint="Email changes will be supported with re-verification in a later phase.">
          <Input id="email" value={email} disabled readOnly />
        </FormField>
        <FormField id="phone" label="Phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" autoComplete="tel" inputMode="tel" {...form.register("phone")} />
        </FormField>
        <FormField id="currency" label="Currency" hint="INR today; the database supports more currencies later." error={errors.currency?.message}>
          <NativeSelect id="currency" {...form.register("currency")}>
            <option value="INR">INR — Indian Rupee (₹)</option>
          </NativeSelect>
        </FormField>
        <FormField id="timezone" label="Timezone" hint="Used to decide which day/month a transaction falls in." error={errors.timezone?.message}>
          <NativeSelect id="timezone" {...form.register("timezone")}>
            {tzOptions.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="cardUtilizationAlertPct" label="Card utilization alert (%)" hint="Warn when card usage goes above this share of the limit." error={errors.cardUtilizationAlertPct?.message}>
          <Input id="cardUtilizationAlertPct" type="number" inputMode="decimal" min={1} max={100} step="1" {...form.register("cardUtilizationAlertPct")} />
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !isDirty} className="w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}
