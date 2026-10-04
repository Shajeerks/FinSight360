import { redirect } from "next/navigation";
import { ShieldCheck, LineChart, Layers } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 p-10 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-300/10 blur-3xl" />
        <Logo className="relative [&_span]:text-white [&_.text-primary]:text-teal-200" />
        <div className="relative mt-auto max-w-md space-y-8">
          <h2 className="text-3xl font-semibold leading-tight">
            Every rupee, every account, every EMI — one clear picture.
          </h2>
          <ul className="space-y-4 text-teal-50/90">
            <li className="flex gap-3"><Layers className="mt-0.5 size-5 shrink-0 text-teal-200" /> Bank accounts, credit cards, loans and investments in a single ledger.</li>
            <li className="flex gap-3"><LineChart className="mt-0.5 size-5 shrink-0 text-teal-200" /> Monthly cash flow, net worth and spending insights.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-teal-200" /> Private by design — no card CVV, PIN, OTP or bank passwords are ever stored.</li>
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-teal-100/60">Personal financial analysis, not financial advice.</p>
      </aside>
      <main className="flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Logo className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
