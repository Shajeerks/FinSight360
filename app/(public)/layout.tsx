import { Logo } from "@/components/brand/logo";

/** Minimal public layout (works whether or not the visitor is signed in). */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
