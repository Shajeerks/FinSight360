import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getAuthMethods } from "@/services/auth-methods.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { UnlinkMethodButton } from "@/features/settings/settings-components";
import { linkMethodAction } from "@/features/settings/settings-actions";

export const metadata: Metadata = { title: "Authentication methods" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function AuthenticationPage({ searchParams }: PageProps<"/settings/authentication">) {
  const user = await requireUser();
  const sp = await searchParams;
  const m = await getAuthMethods(user.id);
  const linked = typeof sp.linked === "string" ? m.providers.find((p) => p.id === sp.linked && p.linked) : undefined;
  const methods = (m.hasPassword ? 1 : 0) + m.providers.filter((p) => p.linked).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Authentication Methods" description="The ways you can sign in to FinSight360." />
      {linked && <Alert variant="success">{linked.label} sign-in added. You can now use it on the sign-in page.</Alert>}
      {sp.error === "not-configured" && <Alert variant="destructive">That sign-in method isn&apos;t configured on this server.</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Your sign-in methods</CardTitle>
          <CardDescription>Signed in as {m.email}. Keep at least two methods so you can always get in.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y">
            <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="size-4" /></span>
                <div>
                  <p className="font-medium">Email & password</p>
                  <p className="text-xs text-muted-foreground">{m.hasPassword ? "Password set" : "No password yet"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.hasPassword ? "success" : "secondary"}>{m.hasPassword ? "On" : "Not set"}</Badge>
                <Button asChild size="sm" variant="outline"><Link href="/settings/security">{m.hasPassword ? "Change" : "Set password"}</Link></Button>
              </div>
            </li>
            {m.providers.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-sm font-semibold">{p.label[0]}</span>
                  <div>
                    <p className="font-medium">{p.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.linked ? `Linked ${p.linkedAt ? fmt.format(p.linkedAt) : ""}` : p.configured ? `Not linked — sign in with ${p.label} from here to add it.` : "Not configured on this server."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.linked ? "success" : "secondary"}>{p.linked ? "Linked" : p.configured ? "Available" : "Unavailable"}</Badge>
                  {p.linked ? (
                    methods > 1 ? <UnlinkMethodButton provider={p.id} label={p.label} /> : null
                  ) : p.configured ? (
                    <form action={linkMethodAction}>
                      <input type="hidden" name="provider" value={p.id} />
                      <Button type="submit" size="sm">Add {p.label}</Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How adding a method works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Click <strong>Add</strong>, choose your Google or Microsoft account, and you&apos;re brought back here. A method can only be added while you&apos;re signed in, and you&apos;re notified each time one is added or removed.</p>
          <p>A Microsoft account is never attached to an existing FinSight360 account just because the email matches — it has to be added from this page.</p>
          <p>Microsoft sign-in needs the server&apos;s Azure app (the same one used for Outlook import) to allow the redirect address <code className="rounded bg-muted px-1">/api/auth/callback/microsoft-entra-id</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
