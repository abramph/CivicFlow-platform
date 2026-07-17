import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { listJobTypeSummaries } from "@/lib/platform-operations/jobs";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";

export default async function PlatformJobsPage() {
  await requireSuperAdmin();

  const jobs = await listJobTypeSummaries();

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Background Operations" }]} />
      <PageHeader
        title="Background Operations"
        description="There is no durable job-run table in this schema. Each row below is inferred from the durable table that job type actually writes to as a side effect — read-only, no retry actions (none of these jobs currently expose a safe, idempotent retry entry point)."
      />

      <SectionCard title={`${jobs.length} scheduled job type(s)`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Job type</th>
                <th scope="col" className="px-4 py-3">Route</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Last success</th>
                <th scope="col" className="px-4 py-3">Failures (7 days)</th>
                <th scope="col" className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.jobType} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-900">{job.jobType}</td>
                  <td className="px-4 py-3"><code className="text-xs text-slate-700">{job.route}</code></td>
                  <td className="px-4 py-3"><StatusPill status={job.status} /></td>
                  <td className="px-4 py-3 text-slate-700">{job.lastSuccessAt ? formatDateTime(job.lastSuccessAt) : "Unknown"}</td>
                  <td className="px-4 py-3 text-slate-700">{job.status === "unknown" ? "—" : job.recentFailureCount7d}</td>
                  <td className="px-4 py-3 text-slate-600">{job.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </main>
  );
}
