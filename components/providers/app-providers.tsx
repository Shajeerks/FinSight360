"use client";
import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

/** Registers the service worker (production only — it would cache dev bundles). */
function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster richColors position="top-center" closeButton />
      <ServiceWorker />
    </ThemeProvider>
  );
}
