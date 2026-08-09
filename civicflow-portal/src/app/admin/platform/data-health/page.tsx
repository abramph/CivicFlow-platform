import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";
import { getDataHealthFindings } from "@/lib/platform-operations/data-health";

export default async function DataHealthPage() {
  await requireSuperAdmin();

  const findings = await getDataHealthFindings();
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => f.severity === "info").length;

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Data Health" }]} />
      <PageHeader
        title="Data Health"
        description="Read-only production data-consistency diagnostics across every organization. Detects, never repairs — each finding links to the real product page where a fix (if one is warranted) actually happens."
        actions={[{ href: "/api/admin/data-health/export?format=csv", label: "Export CSV" }]}
      />

      <SectionCard title={`${findings.length} finding(s) — ${critical} critical, ${warning} warning, ${info} info`}>
        {findings.length === 0 ? (
          <p className="text-sm text-slate-600">No data-consistency findings across any organization.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th scope="col" className="px-4 py-3">Severity</th>
                  <th scope="col" className="px-4 py-3">Finding</th>
                  <th scope="col" className="px-4 py-3">Detail</th>
                  <th scope="col" className="px-4 py-3">Affected</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3"><StatusPill status={finding.severity} /></td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{finding.title}</td>
                    <td className="px-4 py-3 text-slate-700">{finding.explanation}</td>
                    <td className="px-4 py-3">
                      {finding.affectedEntity ? (
                        <Link href={finding.href} className="text-emerald-700 hover:underline">
                          {finding.affectedEntity.label}
                        </Link>
                      ) : (
                        <Link href={finding.href} className="text-emerald-700 hover:underline">View</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}
