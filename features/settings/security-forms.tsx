"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LogOut, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { changePasswordSchema, type ChangePasswordInput } from "@/validators/auth";
import { changePasswordAction, resendVerificationAction, revokeAllSessionsAction } from "@/features/settings/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/features/auth/password-input";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await changePasswordAction(values);
      if (res && !res.ok) {
        toast.error(res.error);
        for (const [k, v] of Object.entries(res.fieldErrors ?? {})) form.setError(k as keyof ChangePasswordInput, { message: v[0] });
      }
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {hasPassword && (
        <FormField id="currentPassword" label="Current password" error={errors.currentPassword?.message}>
          <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register("currentPassword")} />
        </FormField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="newPassword" label={hasPassword ? "New password" : "Set a password"} error={errors.newPassword?.message} hint="10+ characters, upper & lowercase and a number.">
          <PasswordInput id="newPassword" autoComplete="new-password" {...form.register("newPassword")} />
        </FormField>
        <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">Changing your password signs you out on every device, including this one.</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending && <Loader2 className="animate-spin" />}
          {hasPassword ? "Change password" : "Set password"}
        </Button>
      </div>
    </form>
  );
}

export function SignOutEverywhereButton() {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!window.confirm("Sign out of FinSight360 on all devices?")) return;
          const res = await revokeAllSessionsAction();
          if (res && !res.ok) toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <LogOut />}
      Sign out everywhere
    </Button>
  );
}

export function ResendVerificationButton() {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await resendVerificationAction();
          if (res.ok) toast.success(res.message ?? "Sent");
          else toast.error(res.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <MailCheck />}
      Resend verification email
    </Button>
  );
}
