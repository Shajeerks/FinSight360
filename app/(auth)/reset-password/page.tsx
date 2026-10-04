import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <div className="grid gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">For your security, this signs you out on all other devices.</p>
      </div>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert variant="destructive">This reset link is missing its token. Please request a new link.</Alert>
      )}
      <Link href="/forgot-password" className="text-center text-sm text-primary hover:underline">
        Request a new link
      </Link>
    </div>
  );
}
