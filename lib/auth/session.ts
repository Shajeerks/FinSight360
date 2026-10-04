import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UnauthorizedError } from "@/lib/errors";

export type SessionUser = { id: string; email: string; name: string | null; image: string | null; role: string };

/** Current user or null. Safe to call from server components, actions and routes. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id || !u.email) return null;
  return { id: u.id, email: u.email, name: u.name ?? null, image: u.image ?? null, role: u.role ?? "USER" };
}

/** For pages / layouts: redirects to /login when not signed in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For API routes / server actions: throws 401 when not signed in. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
