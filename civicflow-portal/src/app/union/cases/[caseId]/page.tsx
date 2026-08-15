import Link from "next/link";
import { getUnionCasesPageGate } from "@/lib/union/cases-guard";
import { getUnionCaseDetail } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";
import {
  UnionCaseAssignForm,
  UnionCaseTransitionActions,
  UnionCaseCommentForm,
  UnionCaseContractReferenceForm,
  UnionCaseDeadlineForm,
  UnionCaseDeadlineCompleteButton,
} from "@/components/union/UnionCaseActions";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  TRIAGE: "Triage",
  ASSIGNED: "Assigned",
  ACTIVE: "Active",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn",
};

function memberLabel(m: { firstName: string; lastName: string } | null) {
  return m ? `${m.firstName} ${m.lastName}`.trim() : "—";
}

export default async function UnionCaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { organizationId, can } = await getUnionCasesPageGate(PERMISSIONS.UNION_CASES_READ);
  const { caseId } = await params;
  const unionCase = await getUnionCaseDetail(organizationId, caseId);

  const canManage = can(PERMISSIONS.UNION_CASES_MANAGE);
  const canClose = can(PERMISSIONS.UNION_CASES_CLOSE);
  const canNotesInternal = can(PERMISSIONS.UNION_CASES_NOTES_INTERNAL);
  const canDeadlinesManage = can(PERMISSIONS.UNION_CASES_DEADLINES_MANAGE);

  const assignableMembers = canManage
    ? (
        await prisma.orgMember.findMany({
          where: { organizationId, membershipStatus: "active" },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          select: { id: true, firstName: true, lastName: true },
          take: 500,
        })
      ).map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}`.trim() }))
    : [];

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/union/cases", label: "Union Case Center" }, { label: `UC-${unionCase.caseNumber}` }]} />
      <PageHeader
        title={unionCase.title}
        description={`UC-${unionCase.caseNumber} · ${memberLabel(unionCase.member)} · ${unionCase.caseType} · Opened ${formatDateTime(unionCase.openedAt)}`}
      />

      <SectionCard title="Status">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill status={unionCase.status.toLowerCase()} label={STATUS_LABELS[unionCase.status] ?? unionCase.status} />
          <span className="text-sm text-slate-700">Assigned to: {memberLabel(unionCase.assignedTo)}</span>
          {unionCase.isFormalGrievance ? <span className="text-sm font-semibold text-amber-800">Formal grievance</span> : null}
          {unionCase.representationRequested ? <span className="text-sm text-slate-700">Representation requested</span> : null}
          {unionCase.incidentDate ? <span className="text-sm text-slate-700">Incident {formatDateTime(unionCase.incidentDate)}</span> : null}
          {unionCase.resolvedAt ? <span className="text-sm text-slate-700">Resolved {formatDateTime(unionCase.resolvedAt)}</span> : null}
          {unionCase.closedAt ? <span className="text-sm text-slate-700">Closed {formatDateTime(unionCase.closedAt)}</span> : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{unionCase.description}</p>
        {unionCase.resolutionSummary ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolution summary (member-visible)</p>
            <p className="mt-1 text-sm text-slate-900">{unionCase.resolutionSummary}</p>
          </div>
        ) : null}
      </SectionCard>

      {canManage ? (
        <SectionCard title="Assignment">
          <UnionCaseAssignForm caseId={unionCase.id} assignableMembers={assignableMembers} currentAssigneeId={unionCase.assignedToOrgMemberId} />
        </SectionCard>
      ) : null}

      {canManage || canClose ? (
        <SectionCard title="Actions">
          <UnionCaseTransitionActions caseId={unionCase.id} status={unionCase.status} canManage={canManage} canClose={canClose} />
        </SectionCard>
      ) : null}

      <SectionCard title="Notes" description="Internal notes (default) are union-staff-only and never shown to the member.">
        {unionCase.comments.length === 0 ? (
          <p className="text-sm text-slate-600">No notes yet.</p>
        ) : (
          <ul className="space-y-3">
            {unionCase.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.isPrivate ? "Internal (union staff only)" : "Visible to member"} · {formatDateTime(c.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-800">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canManage || canNotesInternal ? <UnionCaseCommentForm caseId={unionCase.id} canNotesInternal={canNotesInternal} /> : null}
      </SectionCard>

      <SectionCard title="Contract references">
        {unionCase.contractReferences.length === 0 ? (
          <p className="text-sm text-slate-600">No contract references yet.</p>
        ) : (
          <ul className="space-y-2">
            {unionCase.contractReferences.map((r) => (
              <li key={r.id} className="text-sm">
                <span className="font-semibold text-slate-900">{r.reference}</span>
                {r.note ? <span className="text-slate-600"> — {r.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? <UnionCaseContractReferenceForm caseId={unionCase.id} /> : null}
      </SectionCard>

      <SectionCard title="Deadlines" description="Missed deadlines are what the dashboard's Overdue chip surfaces.">
        {unionCase.deadlines.length === 0 ? (
          <p className="text-sm text-slate-600">No deadlines yet.</p>
        ) : (
          <ul className="space-y-2">
            {unionCase.deadlines.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span className={d.completedAt ? "text-slate-500 line-through" : !d.completedAt && d.dueAt < new Date() ? "font-semibold text-red-700" : "text-slate-800"}>
                  {d.deadlineType} — {formatDateTime(d.dueAt)}
                  {d.description ? ` — ${d.description}` : ""}
                </span>
                {canDeadlinesManage && !d.completedAt ? <UnionCaseDeadlineCompleteButton caseId={unionCase.id} deadlineId={d.id} /> : null}
              </li>
            ))}
          </ul>
        )}
        {canDeadlinesManage ? <UnionCaseDeadlineForm caseId={unionCase.id} /> : null}
      </SectionCard>

      <SectionCard title="Status history" description="Complete audit trail of every status change.">
        <ul className="space-y-2">
          {unionCase.statusHistory.map((h) => (
            <li key={h.id} className="flex items-center justify-between text-sm">
              <span className="text-slate-700">
                {h.fromStatus ? `${STATUS_LABELS[h.fromStatus] ?? h.fromStatus} → ` : ""}
                <strong>{STATUS_LABELS[h.toStatus] ?? h.toStatus}</strong>
                {h.notes ? <span className="text-slate-500"> — {h.notes}</span> : null}
              </span>
              <span className="text-slate-500">{formatDateTime(h.createdAt)}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <p className="text-sm">
        <Link href="/union/cases" className="font-semibold text-emerald-700 hover:underline">
          ← Back to Union Case Center
        </Link>
      </p>
    </main>
  );
}
