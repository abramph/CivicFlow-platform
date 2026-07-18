import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, Pagination, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { LabEnrollmentStatusButton, LabEnrollmentNewForm } from "@/components/admin/LabEnrollmentControls";
import { formatDateTime } from "@/lib/formatting";
import {
  listLabFeatureDefinitions,
  listLabEnrollments,
} from "@/lib/platform-operations/labs";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function PlatformLabsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSuperAdmin();

  const params = await searchParams;
  const featureKey = getValue(params.featureKey);
  const organizationId = getValue(params.organizationId);
  const page = Number(getValue(params.page)) || 1;

  const features = listLabFeatureDefinitions();
  const enrollments = await listLabEnrollments(
    { featureKey: featureKey || undefined, organizationId: organizationId || undefined },
    { page, pageSize: 25 }
  );

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/admin/platform", label: "Overview" }, { label: "Unestra Labs" }]} />
      <PageHeader
        title="Unestra Labs"
        description="Registered Labs features, their lifecycle, and per-organization enrollment. Enrollment changes here never touch an organization's paid plan, Stripe, or billing exemption."
      />

      <SectionCard title="Registered features" description="The full Labs feature registry — see src/lib/labs/registry.ts. Internal-only features can never be enabled for a non-billing-exempt organization.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Internal only</th>
                <th className="px-4 py-3">Entitlement required</th>
                <th className="px-4 py-3">Enrollment required</th>
                <th className="px-4 py-3">Metered</th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature) => (
                <tr key={feature.key} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs text-slate-900">{feature.key}</td>
                  <td className="px-4 py-3 text-slate-900">{feature.name}</td>
                  <td className="px-4 py-3"><StatusPill status={feature.lifecycle.toLowerCase()} label={feature.lifecycle} /></td>
                  <td className="px-4 py-3 text-slate-900">{feature.internalOnly ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-900">{feature.requiresEntitlement ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-900">{feature.requiresEnrollment ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 text-slate-900">{feature.metered ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Set organization enrollment" description="Write actions require SUPER_ADMIN platform access, an explicit confirmation, and are always audit-logged.">
        <LabEnrollmentNewForm featureKeys={features.map((f) => f.key)} />
      </SectionCard>

      <SectionCard title="Organization enrollments" description={`${enrollments.pagination.totalCount} enrollment record(s).`}>
        <form className="mb-4 grid gap-4 md:grid-cols-3" action="/admin/platform/labs" method="get">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Feature</span>
            <select name="featureKey" defaultValue={featureKey} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200">
              <option value="">All features</option>
              {features.map((f) => (
                <option key={f.key} value={f.key}>{f.key}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Organization ID</span>
            <input name="organizationId" defaultValue={organizationId} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
          </label>
          <div className="flex items-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Filter</button>
          </div>
        </form>

        {enrollments.items.length === 0 ? (
          <EmptyState title="No enrollments match these filters" description="Use the form above to enroll an organization in a Labs feature." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Feature</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3">Actions</th>
                  <th className="px-4 py-3">History</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-900">
                      {row.organizationName} <span className="text-xs text-slate-500">({row.organizationSlug})</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-900">{row.featureKey}</td>
                    <td className="px-4 py-3"><StatusPill status={row.status.toLowerCase()} label={row.status} /></td>
                    <td className="px-4 py-3 text-slate-700">{row.enrollmentSource}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <LabEnrollmentStatusButton organizationId={row.organizationId} featureKey={row.featureKey} currentStatus={row.status} targetStatus="ENABLED" label="Enable" />
                        <LabEnrollmentStatusButton organizationId={row.organizationId} featureKey={row.featureKey} currentStatus={row.status} targetStatus="SUSPENDED" label="Suspend" />
                        <LabEnrollmentStatusButton organizationId={row.organizationId} featureKey={row.featureKey} currentStatus={row.status} targetStatus="DISABLED" label="Disable" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/platform/labs/${row.id}`} className="text-emerald-700 hover:underline">View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Pagination
            basePath="/admin/platform/labs"
            searchParams={{ featureKey: featureKey || undefined, organizationId: organizationId || undefined }}
            page={enrollments.pagination.page}
            totalPages={enrollments.pagination.totalPages}
          />
        </div>
      </SectionCard>
    </main>
  );
}
