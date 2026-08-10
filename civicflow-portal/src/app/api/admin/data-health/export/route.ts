import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { csvCell } from "@/lib/csv-safety";
import { getDataHealthFindings } from "@/lib/platform-operations/data-health";

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/** GET: CSV export of every current data-health finding, across every organization. Read-only — this route never modifies data, mirroring the tool's own "detect, never repair" rule. */
export async function GET() {
  return withApiErrorHandling(async () => {
    await requireSuperAdmin("throw");

    const findings = await getDataHealthFindings();

    const headers = ["Severity", "Finding", "Detail", "Affected Entity Type", "Affected Entity Id", "Affected Entity Label", "Link"];
    const rows = findings.map((f) => [
      f.severity,
      f.title,
      f.explanation,
      f.affectedEntity?.type ?? "",
      f.affectedEntity?.id ?? "",
      f.affectedEntity?.label ?? "",
      f.href,
    ]);
    const csv = [headers.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="unestra-data-health-${exportDateStamp()}.csv"`,
      },
    });
  });
}
