import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { formatDateTime } from "@/lib/formatting";
import { getMemberIntakePageGate } from "@/lib/member-intake/guard";
import { getSubmissionDetail, type FieldDiffEntry, type MemberSummary } from "@/lib/member-intake/review";
import { MemberIntakeError } from "@/lib/member-intake/errors";
import { MemberIntakeReviewActions } from "@/components/labs/member-intake/MemberIntakeReviewActions";
import { PERMISSIONS } from "@/lib/rbac";

const SENSITIVITY_BADGE: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700",
  MODERATE: "bg-amber-100 text-amber-800",
  HIGH: "bg-red-100 text-red-800",
};

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function DiffTable({ diff }: { diff: FieldDiffEntry[] }) {
  const changed = diff.filter((d) => d.changed);
  if (changed.length === 0) {
    return <p className="text-sm text-slate-600">No field changes detected against this member.</p>;
  }
  return (
    <table className="min-w-full text-sm">
      <thead className="bg-slate-50 text-left text-slate-700">
        <tr>
          <th className="px-3 py-2">Field</th>
          <th className="px-3 py-2">Current</th>
          <th className="px-3 py-2">Submitted</th>
          <th className="px-3 py-2">Sensitivity</th>
        </tr>
      </thead>
      <tbody>
        {changed.map((d) => (
          <tr key={d.fieldKey} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium text-slate-900">{d.label}</td>
            <td className="px-3 py-2 text-slate-600">{displayValue(d.previousValue)}</td>
            <td className="px-3 py-2 font-semibold text-emerald-700">{displayValue(d.newValue)}</td>
            <td className="px-3 py-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${SENSITIVITY_BADGE[d.sensitivity]}`}>{d.sensitivity}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MemberCard({ member, diff }: { member: MemberSummary; diff: FieldDiffEntry[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-900">
        {member.firstName} {member.lastName} <span className="text-xs font-normal text-slate-500">({member.id})</span>
      </p>
      <p className="text-xs text-slate-500">
        {member.email ?? "no email"} · {member.phone ?? "no phone"} · {member.membershipStatus}
      </p>
      <div className="overflow-x-auto">
        <DiffTable diff={diff} />
      </div>
    </div>
  );
}

export default async function MemberIntakeSubmissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, access, can } = await getMemberIntakePageGate(PERMISSIONS.MEMBER_INTAKE_VIEW);
  const { id } = await params;

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Submission" description="Not available for this organization." />
      </main>
    );
  }

  let submission;
  try {
    submission = await getSubmissionDetail(organizationId, id);
  } catch (error) {
    if (error instanceof MemberIntakeError && error.code === "MEMBER_INTAKE_SUBMISSION_NOT_FOUND") notFound();
    throw error;
  }

  const canReview = can(PERMISSIONS.MEMBER_INTAKE_REVIEW);
  const fieldEntries = Object.entries(submission.fieldValues).filter(([key]) => key !== "sourceToken");

  return (
    <main className="space-y-6">
      <PageHeader
        title="Submission Review"
        description={`Submitted to "${submission.formName}" on ${formatDateTime(submission.submittedAt)}`}
        actions={[{ href: "/labs/member-intake/submissions", label: "Back to Submissions" }]}
      />

      <SectionCard title="Submitted information" description="Exactly what the person entered on the public form.">
        <dl className="grid gap-3 sm:grid-cols-2">
          {fieldEntries.map(([key, value]) => (
            <div key={key}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key}</dt>
              <dd className="text-sm text-slate-900">{displayValue(value)}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <SectionCard
        title="Match & verification"
        description="How Unestra's matching engine classified this submission, and whether identity verification completed."
      >
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Match method</dt>
            <dd className="text-sm text-slate-900">{submission.matchMethod ?? "No match found"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Confidence</dt>
            <dd className="text-sm text-slate-900">{submission.matchConfidence ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification</dt>
            <dd className="text-sm text-slate-900">{submission.verificationStatus}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="text-sm text-slate-900">{submission.status}</dd>
          </div>
        </dl>
      </SectionCard>

      {submission.matchedMember ? (
        <SectionCard title="Matched member" description="The one existing member this submission is confidently about.">
          <MemberCard member={submission.matchedMember} diff={submission.diffByMemberId[submission.matchedMember.id] ?? []} />
        </SectionCard>
      ) : null}

      {submission.candidateMembers.length > 0 ? (
        <SectionCard title="Possible matches" description="Compare each candidate before linking this submission to one of them.">
          <div className="space-y-3">
            {submission.candidateMembers.map((member) => (
              <MemberCard key={member.id} member={member} diff={submission.diffByMemberId[member.id] ?? []} />
            ))}
          </div>
        </SectionCard>
      ) : null}

      {submission.rejectionReason ? (
        <SectionCard title="Rejected" description={formatDateTime(submission.rejectedAt)}>
          <p className="text-sm text-slate-900">{submission.rejectionReason}</p>
        </SectionCard>
      ) : null}

      {submission.createdMemberId ? (
        <SectionCard title="Applied" description="This submission created a new member record.">
          <Link href={`/members/${submission.createdMemberId}`} className="text-sm font-semibold text-emerald-700 hover:underline">
            View member
          </Link>
        </SectionCard>
      ) : null}

      <SectionCard title="Review actions" description="Actions here immediately create or update the member record — they cannot be undone automatically.">
        <MemberIntakeReviewActions
          submissionId={submission.id}
          status={submission.status}
          canReview={canReview}
          hasMatchedMember={Boolean(submission.matchedMemberId)}
          candidateMemberIds={submission.candidateMembers.map((m) => m.id)}
        />
        {!canReview ? <p className="text-sm text-slate-600">You have view-only access to Member Intake submissions.</p> : null}
      </SectionCard>
    </main>
  );
}
