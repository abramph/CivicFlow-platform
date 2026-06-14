import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDateTime, formatText } from "@/lib/formatting";

export default async function AuditLogsPage() {
  const { organizationId } = await requirePermission("audit_logs:read");
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Audit Logs"
        description="Review organization-scoped write activity, including who performed the action, what resource changed, and when it happened."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Audit Events" value={rows.length} />
        <StatCard label="Recent Actors" value={new Set(rows.map((row) => row.actorEmail).filter(Boolean)).size} />
        <StatCard label="Resources" value={new Set(rows.map((row) => row.resource)).size} />
      </div>

      <SectionCard title="Audit Feed" description="All entries are constrained to the active organization and reflect the structured audit helper used by protected route handlers.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Resource ID</th>
                <th className="px-4 py-3">Actor</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-600">
                    No audit events have been recorded yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">{formatDateTime(row.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-900">{row.action}</td>
                    <td className="px-4 py-3 text-slate-900">{row.resource}</td>
                    <td className="px-4 py-3 text-slate-900">{formatText(row.resourceId, "—")}</td>
                    <td className="px-4 py-3 text-slate-900">{formatText(row.actorEmail, "system")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
