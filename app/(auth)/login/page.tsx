import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/features/auth/login-form";
import { GoogleSignInButton, OrDivider } from "@/features/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { isGoogleAuthEnabled } from "@/lib/env";
import { safeCallbackUrl } from "@/features/auth/callback-url";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: "This email is already linked to another sign-in method.",
  AccessDenied: "Access denied. Your account may be disabled.",
  GoogleNotConfigured: "Google sign-in isn't configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.",
  Configuration: "Sign-in is misconfigured. Check the server logs.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const callbackUrl = safeCallbackUrl(one(sp.callbackUrl));
  const error = one(sp.error);
  const google = isGoogleAuthEnabled();

  return (
    <div className="grid gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your FinSight360 account.</p>
      </div>
      {one(sp.signedOut) && <Alert variant="info">You have been signed out.</Alert>}
      {one(sp.reset) && <Alert variant="success">Password updated — sign in with your new password.</Alert>}
      {one(sp.registered) && <Alert variant="info">Account created. Check your email to verify it, then sign in.</Alert>}
      {error && <Alert variant="destructive">{ERRORS[error] ?? "Sign-in failed. Please try again."}</Alert>}
      {google && (
        <>
          <GoogleSignInButton callbackUrl={callbackUrl} />
          <OrDivider />
        </>
      )}
      <LoginForm callbackUrl={callbackUrl} />
      <p className="text-center text-sm text-muted-foreground">
        New to FinSight360?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
