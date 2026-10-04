"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route-level error boundary. Never shows stack traces to the user. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Logged to the browser console with only the digest for correlation with server logs.
    console.error("FinSight360 error", error.digest);
  }, [error]);
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-muted-foreground">
        We couldn&apos;t load this page. Your data is safe — please try again.
        {error.digest ? <span className="mt-2 block text-xs">Reference: {error.digest}</span> : null}
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
