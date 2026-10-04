import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { getRecentAuditLog } from "@/services/profile.service";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { describeAuditAction } from "@/features/settings/audit-labels";

export const metadata: Metadata = { title: "Audit Log" };

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function AuditLogPage() {
  const user = await requireUser();
  const entries = await getRecentAuditLog(user.id, 200);
  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="The latest 200 security-relevant events on your account." />
      <Card>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Event</th>
                  <th className="px-5 py-3 font-medium">Entity</th>
                  <th className="px-5 py-3 font-medium">IP address</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{fmt.format(e.createdAt)}</td>
                    <td className="px-5 py-3 font-medium">{describeAuditAction(e.action)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{e.entityType ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{e.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y md:hidden">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <p className="text-sm font-medium">{describeAuditAction(e.action)}</p>
                <p className="text-xs text-muted-foreground">{fmt.format(e.createdAt)}{e.ipAddress ? ` · ${e.ipAddress}` : ""}</p>
              </li>
            ))}
          </ul>
          {!entries.length && <p className="p-6 text-sm text-muted-foreground">No activity recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
