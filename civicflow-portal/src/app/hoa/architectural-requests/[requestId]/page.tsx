import Link from "next/link";
import { getArchitecturalRequestsPageGate } from "@/lib/hoa/architectural-requests-guard";
import { getArchitecturalRequestDetail } from "@/lib/hoa/architectural-requests";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";
import { ArchitecturalRequestActions, ArchitecturalRequestCommentForm } from "@/components/hoa/ArchitecturalRequestActions";

const STATUS_LABELS: Record<string, string> = {
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

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

export default async function ArchitecturalRequestDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { organizationId, access, can } = await getArchitecturalRequestsPageGate(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Architectural request" description="Not available for this organization." />
      </main>
    );
  }

  const { requestId } = await params;
  const request = await getArchitecturalRequestDetail(organizationId, requestId);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/hoa/architectural-requests", label: "Architectural Requests" }, { label: `AR-${request.requestNumber}` }]} />
      <PageHeader
        title={request.title}
        description={`AR-${request.requestNumber} · ${propertyLabel(request.property)} · ${request.category} · Submitted ${
          request.submittedAt ? formatDateTime(request.submittedAt) : "not yet submitted"
        }`}
        actions={[{ href: `/hoa/properties/${request.property.id}`, label: "View property" }]}
      />

      <SectionCard title="Status">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill status={request.status.toLowerCase()} label={STATUS_LABELS[request.status] ?? request.status} />
          {request.proposedStartDate ? <span className="text-sm text-slate-700">Proposed start {formatDateTime(request.proposedStartDate)}</span> : null}
          {request.decidedAt ? <span className="text-sm text-slate-700">Decided {formatDateTime(request.decidedAt)}</span> : null}
          {request.expirationDate ? <span className="text-sm text-slate-700">Expires {formatDateTime(request.expirationDate)}</span> : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{request.projectDescription}</p>
        {request.decisionSummary ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision summary (resident-visible)</p>
            <p className="mt-1 text-sm text-slate-900">{request.decisionSummary}</p>
          </div>
        ) : null}
        {request.conditions ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Conditions (resident-visible)</p>
            <p className="mt-1 text-sm text-amber-900">{request.conditions}</p>
          </div>
        ) : null}
      </SectionCard>

      {can(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW) || can(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_DECIDE) ? (
        <SectionCard title="Actions">
          <ArchitecturalRequestActions
            requestId={request.id}
            status={request.status}
            canReview={can(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW)}
            canDecide={can(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_DECIDE)}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Comments" description="Private comments (default) are board/committee-only and never shown to the resident.">
        {request.comments.length === 0 ? (
          <p className="text-sm text-slate-600">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {request.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.isPrivate ? "Private (board/committee-only)" : "Visible to resident"} · {formatDateTime(c.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-800">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {can(PERMISSIONS.HOA_ARCHITECTURAL_REQUESTS_REVIEW) ? <ArchitecturalRequestCommentForm requestId={request.id} /> : null}
      </SectionCard>

      <SectionCard title="Status history" description="Complete audit trail of every status change.">
        <ul className="space-y-2">
          {request.statusHistory.map((h) => (
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
        <Link href="/hoa/architectural-requests" className="font-semibold text-emerald-700 hover:underline">← Back to Architectural Requests</Link>
      </p>
    </main>
  );
}
