import Link from "next/link";
import { getHoaViolationsPageGate } from "@/lib/hoa/violations-guard";
import { listViolations } from "@/lib/hoa/violations";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";

const STATUSES = ["DRAFT", "ISSUED", "ACKNOWLEDGED", "IN_REVIEW", "CURED", "RESOLVED", "DISMISSED"] as const;
type StatusValue = (typeof STATUSES)[number];

const STATUS_LABELS: Record<StatusValue, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  ACKNOWLEDGED: "Acknowledged",
  IN_REVIEW: "In review",
  CURED: "Cured",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

const STATUS_PILL: Record<StatusValue, "healthy" | "warning" | "critical" | "unknown"> = {
  DRAFT: "unknown",
  ISSUED: "warning",
  ACKNOWLEDGED: "warning",
  IN_REVIEW: "warning",
  CURED: "healthy",
  RESOLVED: "healthy",
  DISMISSED: "unknown",
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

export default async function HoaViolationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, access, can } = await getHoaViolationsPageGate(PERMISSIONS.HOA_VIOLATIONS_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Violations" description="Not available for this organization." />
      </main>
    );
  }

  const params = await searchParams;
  const status = getValue(params.status);
  const violations = await listViolations(organizationId, { status: isStatus(status) ? status : undefined });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Violations"
        description="Compliance issues recorded against a property and their resolution status."
        actions={can(PERMISSIONS.HOA_VIOLATIONS_WRITE) ? [{ href: "/hoa/violations/new", label: "Record violation", tone: "primary" }] : []}
      />

      <SectionCard title="Violation log" description={`${violations.length} violation${violations.length === 1 ? "" : "s"} matching your filters.`}>
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
            <Link href="/hoa/violations" className="text-sm font-semibold text-emerald-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {violations.length === 0 ? (
          <EmptyState
            title={status ? "No violations match your filters" : "No violations have been recorded yet."}
            description={
              status
                ? "Try a different filter or clear it."
                : can(PERMISSIONS.HOA_VIOLATIONS_WRITE)
                  ? "Record your first violation to get started."
                  : "Violations are recorded by a board member or property manager."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Property</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Cure by</th>
                  <th className="px-4 py-3">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      <Link href={`/hoa/violations/${v.id}`} className="hover:underline">
                        {propertyLabel(v.property)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{v.violationType}</td>
                    <td className="px-4 py-3"><StatusPill status={STATUS_PILL[v.status as StatusValue]} label={STATUS_LABELS[v.status as StatusValue]} /></td>
                    <td className="px-4 py-3 text-slate-700">{v.cureByDate ? formatDateTime(v.cureByDate) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(v.createdAt)}</td>
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
