"use client";
import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/validators/auth";
import { forgotPasswordAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";

export function ForgotPasswordForm() {
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit((values) =>
    startTransition(async () => {
      const res = await forgotPasswordAction(values);
      if (res.ok) setDone(res.message ?? "Check your email.");
      else form.setError("email", { message: res.fieldErrors?.email?.[0] ?? res.error });
    }),
  );

  if (done) {
    return (
      <Alert variant="success">
        <MailCheck />
        <div>
          <p className="font-medium">{done}</p>
          <p className="mt-1 text-foreground/70">The link expires in 30 minutes. In local development the email is printed in the terminal running <code>npm run dev</code>.</p>
        </div>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormField id="email" label="Email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" {...form.register("email")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />}
        Send reset link
      </Button>
    </form>
  );
}
