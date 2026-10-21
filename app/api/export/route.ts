import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api";
import { apiContext, searchParamsObject } from "@/lib/api-route";
import { audit, AuditAction } from "@/lib/audit";
import { RateLimitError } from "@/lib/errors";
import { limiters } from "@/lib/security/rate-limit";
import { buildFullExport, fullExportToXlsx } from "@/services/export.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/export?format=xlsx|json — everything in your account (no secrets). */
export const GET = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const rl = await limiters.dataExport.check(`export:${user.id}`);
  if (!rl.allowed) throw new RateLimitError(rl.retryAfterSeconds);
  const format = searchParamsObject(req).format === "json" ? "json" : "xlsx";
  const data = await buildFullExport(user.id);
  await audit({ userId: user.id, action: AuditAction.DATA_EXPORTED, entityType: "User", entityId: user.id, ip: meta.ip, userAgent: meta.userAgent, metadata: { format, rows: Object.fromEntries(Object.entries(data.sheets).map(([k, v]) => [k, v.length])) } });
  const name = `finsight360-export-${data.exportedAt.slice(0, 10)}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (format === "json") {
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.json"` } });
  }
  return new NextResponse(new Uint8Array(await fullExportToXlsx(data)), {
    headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"` },
  });
});
