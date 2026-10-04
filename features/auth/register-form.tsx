"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { registerSchema, type RegisterInput } from "@/validators/auth";
import { registerAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { PasswordInput } from "@/features/auth/password-input";
import { cn } from "@/lib/utils";

const RULES = [
  { label: "10+ characters", test: (v: string) => v.length >= 10 },
  { label: "Uppercase", test: (v: string) => /[A-Z]/.test(v) },
  { label: "Lowercase", test: (v: string) => /[a-z]/.test(v) },
  { label: "Number", test: (v: string) => /[0-9]/.test(v) },
];

export function RegisterForm() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });
  const { errors } = form.formState;
  const password = useWatch({ control: form.control, name: "password" }) ?? "";

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const res = await registerAction(values);
      if (!res.ok) {
        setServerError(res.error);
        for (const [field, msgs] of Object.entries(res.fieldErrors ?? {})) {
          form.setError(field as keyof RegisterInput, { message: msgs[0] });
        }
        return;
      }
      if (res.message) toast.success(res.message);
      router.replace(res.data?.redirectTo ?? "/dashboard");
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {serverError && <Alert variant="destructive">{serverError}</Alert>}
      <FormField id="name" label="Full name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...form.register("name")} />
      </FormField>
      <FormField id="email" label="Email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" aria-invalid={!!errors.email} {...form.register("email")} />
      </FormField>
      <FormField id="password" label="Password" error={errors.password?.message}>
        <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...form.register("password")} />
      </FormField>
      <ul className="-mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Password requirements">
        {RULES.map((r) => {
          const met = r.test(password);
          return (
            <li key={r.label} className={cn("flex items-center gap-1", met ? "text-success" : "text-muted-foreground")}>
              <Check className={cn("size-3", !met && "opacity-30")} /> {r.label}
            </li>
          );
        })}
      </ul>
      <FormField id="confirmPassword" label="Confirm password" error={errors.confirmPassword?.message}>
        <PasswordInput id="confirmPassword" autoComplete="new-password" aria-invalid={!!errors.confirmPassword} {...form.register("confirmPassword")} />
      </FormField>
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
        {pending && <Loader2 className="animate-spin" />}
        Create account
      </Button>
    </form>
  );
}
