import Link from "next/link";
import { getArchitecturalRequestsPageGate } from "@/lib/hoa/architectural-requests-guard";
import { listArchitecturalRequests } from "@/lib/hoa/architectural-requests";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";

const STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "RESUBMITTED",
  "APPROVED",
  "CONDITIONALLY_APPROVED",
  "DENIED",
  "WITHDRAWN",
  "EXPIRED",
] as const;
type StatusValue = (typeof STATUSES)[number];

const STATUS_LABELS: Record<StatusValue, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  RESUBMITTED: "Resubmitted",
  APPROVED: "Approved",
  CONDITIONALLY_APPROVED: "Conditionally approved",
  DENIED: "Denied",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
};

const STATUS_PILL: Record<StatusValue, "healthy" | "warning" | "critical" | "unknown"> = {
  DRAFT: "unknown",
  SUBMITTED: "warning",
  IN_REVIEW: "warning",
  CHANGES_REQUESTED: "warning",
  RESUBMITTED: "warning",
  APPROVED: "healthy",
  CONDITIONALLY_APPROVED: "healthy",
  DENIED: "critical",
  WITHDRAWN: "unknown",
  EXPIRED: "unknown",
};

function isStatus(value: string): value is StatusValue {
  return (STATUSES as readonly string[]).includes(value);
}

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ArchitecturalRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, access } = await getArchitecturalRequestsPageGate(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Architectural Requests" description="Not available for this organization." />
      </main>
    );
  }

  const params = await searchParams;
  const status = getValue(params.status);
  const requests = await listArchitecturalRequests(organizationId, { status: isStatus(status) ? status : undefined });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Architectural Requests"
        description="Resident submissions for exterior or property modifications and their review status."
      />

      <SectionCard title="Request log" description={`${requests.length} request${requests.length === 1 ? "" : "s"} matching your filters.`}>
        <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
            Filter
          </button>
          {status ? (
            <Link href="/hoa/architectural-requests" className="text-sm font-semibold text-emerald-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {requests.length === 0 ? (
          <EmptyState
            title={status ? "No requests match your filters" : "No architectural requests have been submitted yet."}
            description={status ? "Try a different filter or clear it." : "Requests are submitted by property owners from their own resident portal."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">Property</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      <Link href={`/hoa/architectural-requests/${r.id}`} className="hover:underline">
                        AR-{r.requestNumber} · {r.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{propertyLabel(r.property)}</td>
                    <td className="px-4 py-3 text-slate-700">{r.category}</td>
                    <td className="px-4 py-3"><StatusPill status={STATUS_PILL[r.status as StatusValue]} label={STATUS_LABELS[r.status as StatusValue]} /></td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(r.createdAt)}</td>
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
