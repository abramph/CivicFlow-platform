import Link from "next/link";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { listSubmissions, type SubmissionQueueFilter } from "@/lib/member-intake/review";
import { PERMISSIONS } from "@/lib/rbac";

const FILTERS: { value: SubmissionQueueFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "NEEDS_VERIFICATION", label: "Needs Verification" },
  { value: "NEEDS_REVIEW", label: "Needs Review" },
  { value: "POSSIBLE_DUPLICATES", label: "Possible Duplicates" },
  { value: "NEW_MEMBERS", label: "New Members" },
  { value: "UPDATES", label: "Updates" },
  { value: "REJECTED", label: "Rejected" },
];

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Processing",
  VERIFICATION_REQUIRED: "Awaiting verification",
  REVIEW_REQUIRED: "Needs review",
  APPROVED: "Approved",
  APPLIED: "Applied",
  REJECTED: "Rejected",
};

const STATUS_BADGE: Record<string, string> = {
  SUBMITTED: "bg-slate-100 text-slate-700",
  VERIFICATION_REQUIRED: "bg-amber-100 text-amber-800",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  APPLIED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default async function MemberIntakeSubmissionsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { organizationId, access } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_VIEW);
  const { filter: filterParam } = await searchParams;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Member Intake Submissions" description="Not available for this organization." />
      </main>
    );
  }

  const filter = FILTERS.some((f) => f.value === filterParam) ? (filterParam as SubmissionQueueFilter) : "ALL";
  const { submissions } = await listSubmissions(organizationId, { filter });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Member Intake Submissions"
        description="Review new members, profile updates, and possible duplicates before they touch a member record."
        actions={[{ href: "/labs/member-intake/forms", label: "Back to Forms" }]}
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "ALL" ? "/labs/member-intake/submissions" : `/labs/member-intake/submissions?filter=${f.value}`}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.value ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <SectionCard title="Submissions" description="Sorted by most recent first.">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-700">
              <tr>
                <th className="px-4 py-3">Submitter</th>
                <th className="px-4 py-3">Form</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Match</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                    No submissions in this view.
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link href={`/labs/member-intake/submissions/${s.id}`} className="font-semibold text-emerald-700 hover:underline">
                        {s.submitter}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-900">{s.formName}</td>
                    <td className="px-4 py-3 text-slate-600">{s.sourceName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[s.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {STATUS_LABEL[s.status] ?? formatEnumLabel(s.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {s.matchedMemberId ? "Existing member" : s.candidateCount > 0 ? `${s.candidateCount} possible match${s.candidateCount === 1 ? "" : "es"}` : "New person"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(s.submittedAt)}</td>
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
