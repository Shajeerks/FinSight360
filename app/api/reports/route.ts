import { NextResponse } from "next/server";
import { apiHandler, ok } from "@/lib/api";
import { apiContext, searchParamsObject } from "@/lib/api-route";
import { buildReport, reportToCsv, reportToXlsx } from "@/services/report.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports?type=expenses|income|transactions|cards|loans|interest|investments|networth&from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv|xlsx
 */
export const GET = apiHandler(async (req) => {
  const { user, meta } = await apiContext();
  const q = searchParamsObject(req);
  const report = await buildReport(user.id, q);
  const name = `finsight360-${report.type}-${report.from}-to-${report.to}`;
  const { audit } = await import("@/lib/audit");
  if (q.format === "csv" || q.format === "xlsx") {
    await audit({ userId: user.id, action: "report.exported", entityType: "Report", ip: meta.ip, userAgent: meta.userAgent, metadata: { type: report.type, format: q.format, rows: report.rows.length } });
  }
  if (q.format === "csv") {
    return new NextResponse(reportToCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  }
  if (q.format === "xlsx") {
    return new NextResponse(new Uint8Array(await reportToXlsx(report)), {
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" },
    });
  }
  return ok(report);
});
