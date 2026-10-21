import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "@/features/auth/register-form";
import { GoogleSignInButton, MicrosoftSignInButton, OrDivider } from "@/features/auth/google-button";
import { Alert } from "@/components/ui/alert";
import { isGoogleAuthEnabled, isMicrosoftAuthEnabled, isRegistrationAllowed } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  const allowed = isRegistrationAllowed();
  return (
    <div className="grid gap-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">Start tracking your finances in minutes.</p>
      </div>
      {allowed ? (
        <>
          {(isGoogleAuthEnabled() || isMicrosoftAuthEnabled()) && (
            <>
              <div className="grid gap-2">
                {isGoogleAuthEnabled() && <GoogleSignInButton label="Sign up with Google" />}
                {isMicrosoftAuthEnabled() && <MicrosoftSignInButton label="Sign up with Microsoft" />}
              </div>
              <OrDivider />
            </>
          )}
          <RegisterForm />
        </>
      ) : (
        <Alert variant="info">New sign-ups are disabled on this FinSight360 instance.</Alert>
      )}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
