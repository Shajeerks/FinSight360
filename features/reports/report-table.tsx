import type { Report } from "@/services/report.service";
import { cn } from "@/lib/utils";

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmt(kind: string, v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "";
  if (kind === "money") return `₹${inr.format(Number(v))}`;
  if (kind === "percent") return `${Number(v).toFixed(1)}`;
  if (kind === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    return `${String(d.getUTCDate()).padStart(2, "0")}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]}-${d.getUTCFullYear()}`;
  }
  return String(v);
}

/** Server-rendered report table (used on screen and in the print layout). */
export function ReportTable({ report, compact = false }: { report: Report; compact?: boolean }) {
  const right = (k: string) => k === "money" || k === "number" || k === "percent";
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", compact && "text-xs")}>
        <thead>
          <tr className="border-b">
            {report.columns.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 font-medium text-muted-foreground", right(c.kind) ? "text-right" : "text-left")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 && (
            <tr><td colSpan={report.columns.length} className="px-3 py-8 text-center text-muted-foreground">No data for this period.</td></tr>
          )}
          {report.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0 break-inside-avoid">
              {report.columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-1.5", right(c.kind) ? "tabular whitespace-nowrap text-right" : "max-w-[22rem] truncate")}>{fmt(c.kind, r[c.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {report.totals && report.rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 font-semibold">
              {report.columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2", right(c.kind) ? "tabular whitespace-nowrap text-right" : "")}>{fmt(c.kind, report.totals![c.key])}</td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
