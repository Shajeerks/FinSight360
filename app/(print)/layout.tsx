import { requireUser } from "@/lib/auth/session";

/** Bare layout for printable pages (no navigation). */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="min-h-dvh bg-white text-black">{children}</div>;
}
