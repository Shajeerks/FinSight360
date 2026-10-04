import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { verifyEmail } from "@/services/auth.service";
import { getRequestMeta } from "@/lib/security/request";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  let ok = false;
  try {
    await verifyEmail(token, await getRequestMeta());
    ok = true;
  } catch {
    ok = false;
  }
  return (
    <div className="grid justify-items-center gap-4 text-center">
      {ok ? <CheckCircle2 className="size-12 text-success" /> : <XCircle className="size-12 text-destructive" />}
      <h1 className="text-2xl font-semibold tracking-tight">{ok ? "Email verified" : "Link invalid or expired"}</h1>
      <p className="text-sm text-muted-foreground">
        {ok ? "Thanks — your email address is confirmed." : "Sign in and request a new verification email from Settings → Security."}
      </p>
      <Button asChild className="w-full">
        <Link href="/dashboard">Continue</Link>
      </Button>
    </div>
  );
}
