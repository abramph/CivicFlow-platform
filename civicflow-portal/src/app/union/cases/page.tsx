import Link from "next/link";
import { getUnionCasesPageGate } from "@/lib/union/cases-guard";
import { listUnionCases, listUnionCasesByBucket, getUnionCaseDashboardCounts, type UnionCaseDashboardBucket } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";

const STATUSES = ["NEW", "TRIAGE", "ASSIGNED", "ACTIVE", "PENDING", "RESOLVED", "CLOSED", "WITHDRAWN"] as const;
type StatusValue = (typeof STATUSES)[number];

const STATUS_LABELS: Record<StatusValue, string> = {
  NEW: "New",
  TRIAGE: "Triage",
  ASSIGNED: "Assigned",
  ACTIVE: "Active",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn",
};

const STATUS_PILL: Record<StatusValue, "healthy" | "warning" | "critical" | "unknown"> = {
  NEW: "unknown",
  TRIAGE: "warning",
  ASSIGNED: "warning",
  ACTIVE: "warning",
  PENDING: "warning",
  RESOLVED: "healthy",
  CLOSED: "unknown",
  WITHDRAWN: "unknown",
};

const BUCKETS: { value: UnionCaseDashboardBucket; label: string }[] = [
  { value: "unassigned", label: "New / unassigned" },
  { value: "assigned-to-me", label: "Assigned to me" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "deadlines-approaching", label: "Deadlines approaching" },
  { value: "overdue", label: "Overdue" },
  { value: "recently-resolved", label: "Recently resolved" },
];

function isStatus(value: string): value is StatusValue {
  return (STATUSES as readonly string[]).includes(value);
}

function isBucket(value: string): value is UnionCaseDashboardBucket {
  return BUCKETS.some((b) => b.value === value);
}

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function memberLabel(m: { firstName: string; lastName: string } | null) {
  return m ? `${m.firstName} ${m.lastName}`.trim() : "—";
}

/** Steward/officer dashboard (UNION-CASE-B). Answers "what needs my
 * attention today" via bucket chips (counts + one-click filtered lists),
 * plus a plain status/case-type/search filter for the general directory --
 * deliberately not an analytics project. */
export default async function UnionCasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { organizationId, session, access } = await getUnionCasesPageGate(PERMISSIONS.UNION_CASES_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Union Case Center" description="Not available for this organization." />
      </main>
    );
  }

  const viewerMember = await prisma.orgMember.findFirst({ where: { organizationId, userId: session.userId }, select: { id: true } });

  const params = await searchParams;
  const bucket = getValue(params.bucket);
  const status = getValue(params.status);
  const caseType = getValue(params.caseType);
  const search = getValue(params.search);

  const counts = await getUnionCaseDashboardCounts(organizationId, viewerMember?.id ?? "");

  const cases = isBucket(bucket)
    ? await listUnionCasesByBucket(organizationId, bucket, viewerMember?.id ?? null)
    : await listUnionCases(organizationId, {
        status: isStatus(status) ? status : undefined,
        caseType: caseType || undefined,
        search: search || undefined,
      });

  const bucketCountFor = (b: UnionCaseDashboardBucket) =>
    b === "unassigned"
      ? counts.newUnassigned
      : b === "assigned-to-me"
        ? counts.assignedToMe
        : b === "active"
          ? counts.active
          : b === "pending"
            ? counts.pending
            : b === "deadlines-approaching"
              ? counts.deadlinesApproaching
              : b === "overdue"
                ? counts.overdue
                : counts.recentlyResolved;

  return (
    <main className="space-y-6">
      <PageHeader title="Union Case Center" description="Member issues, grievances, and representation cases." />

      <SectionCard title="What needs attention" description="Quick filters — click a chip to see just that list.">
        <div className="flex flex-wrap gap-2">
          {BUCKETS.map((b) => (
            <Link
              key={b.value}
              href={`/union/cases?bucket=${b.value}`}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
                bucket === b.value
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : b.value === "overdue" && bucketCountFor(b.value) > 0
                    ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                    : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              }`}
            >
              {b.label} · {bucketCountFor(b.value)}
            </Link>
          ))}
          {bucket ? (
            <Link href="/union/cases" className="rounded-full px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:underline">
              Clear
            </Link>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Case log" description={`${cases.length} case${cases.length === 1 ? "" : "s"} matching your filters.`}>
        {!bucket ? (
          <form method="GET" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Status</span>
              <select name="status" defaultValue={status} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">All</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Case type</span>
              <input name="caseType" defaultValue={caseType} placeholder="e.g. GRIEVANCE" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Search (case #, title, member)</span>
              <input name="search" defaultValue={search} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <button type="submit" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Filter
            </button>
          </form>
        ) : null}

        {cases.length === 0 ? (
          <EmptyState title="No cases match" description="Try a different chip or filter, or clear it." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Assigned to</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Next deadline</th>
                  <th className="px-4 py-3">Opened</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      <Link href={`/union/cases/${c.id}`} className="hover:underline">
                        UC-{c.caseNumber} · {c.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{memberLabel(c.member)}</td>
                    <td className="px-4 py-3 text-slate-700">{memberLabel(c.assignedTo)}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={STATUS_PILL[c.status as StatusValue]} label={STATUS_LABELS[c.status as StatusValue]} />
                    </td>
                    <td className="px-4 py-3 text-slate-700">{c.deadlines[0] ? formatDateTime(c.deadlines[0].dueAt) : "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDateTime(c.openedAt)}</td>
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
