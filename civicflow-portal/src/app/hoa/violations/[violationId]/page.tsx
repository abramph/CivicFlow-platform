import Link from "next/link";
import { getHoaViolationsPageGate } from "@/lib/hoa/violations-guard";
import { getViolationDetail } from "@/lib/hoa/violations";
import { PERMISSIONS } from "@/lib/rbac";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";
import { ViolationActions, ViolationCommentForm } from "@/components/hoa/ViolationActions";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  ACKNOWLEDGED: "Acknowledged",
  IN_REVIEW: "In review",
  CURED: "Cured",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

function propertyLabel(p: { addressLine1: string; unitLabel: string | null; displayName: string | null }) {
  if (p.displayName) return p.displayName;
  return p.unitLabel ? `${p.addressLine1}, ${p.unitLabel}` : p.addressLine1;
}

export default async function HoaViolationDetailPage({ params }: { params: Promise<{ violationId: string }> }) {
  const { organizationId, access, can } = await getHoaViolationsPageGate(PERMISSIONS.HOA_VIOLATIONS_READ);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Violation" description="Not available for this organization." />
      </main>
    );
  }

  const { violationId } = await params;
  const violation = await getViolationDetail(organizationId, violationId);

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ href: "/hoa/violations", label: "Violations" }, { label: propertyLabel(violation.property) }]} />
      <PageHeader
        title={violation.violationType}
        description={`${propertyLabel(violation.property)} · Recorded ${formatDateTime(violation.createdAt)}`}
        actions={[{ href: `/hoa/properties/${violation.property.id}`, label: "View property" }]}
      />

      <SectionCard title="Status">
        <div className="flex flex-wrap items-center gap-4">
          <StatusPill status={violation.status.toLowerCase()} label={STATUS_LABELS[violation.status] ?? violation.status} />
          {violation.cureByDate ? <span className="text-sm text-slate-700">Cure by {formatDateTime(violation.cureByDate)}</span> : null}
          {violation.issuedAt ? <span className="text-sm text-slate-700">Issued {formatDateTime(violation.issuedAt)}</span> : null}
          {violation.resolvedAt ? <span className="text-sm text-slate-700">Closed {formatDateTime(violation.resolvedAt)}</span> : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-700">{violation.description}</p>
        {violation.resolutionNotes ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Resolution notes (board-only — never shown to the resident)</p>
            <p className="mt-1 text-sm text-amber-900">{violation.resolutionNotes}</p>
          </div>
        ) : null}
      </SectionCard>

      {can(PERMISSIONS.HOA_VIOLATIONS_WRITE) || can(PERMISSIONS.HOA_VIOLATIONS_REVIEW) || can(PERMISSIONS.HOA_VIOLATIONS_RESOLVE) ? (
        <SectionCard title="Actions">
          <ViolationActions
            violationId={violation.id}
            status={violation.status}
            cureByDate={violation.cureByDate ? violation.cureByDate.toISOString().slice(0, 10) : ""}
            canWrite={can(PERMISSIONS.HOA_VIOLATIONS_WRITE)}
            canReview={can(PERMISSIONS.HOA_VIOLATIONS_REVIEW)}
            canResolve={can(PERMISSIONS.HOA_VIOLATIONS_RESOLVE)}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Notices sent" description="Every notice ever sent for this violation — an append-only record.">
        {violation.notices.length === 0 ? (
          <p className="text-sm text-slate-600">No notices sent yet.</p>
        ) : (
          <ul className="space-y-3">
            {violation.notices.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {n.noticeType.replace(/_/g, " ")} · {n.channel} · {formatDateTime(n.sentAt)}
                </p>
                <p className="mt-1 text-sm text-slate-800">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Comments" description="Private comments (default) are board/property-manager-only and never shown to the resident.">
        {violation.comments.length === 0 ? (
          <p className="text-sm text-slate-600">No comments yet.</p>
        ) : (
          <ul className="space-y-3">
            {violation.comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {c.isPrivate ? "Private (board-only)" : "Visible to resident"} · {formatDateTime(c.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-800">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {can(PERMISSIONS.HOA_VIOLATIONS_WRITE) ? <ViolationCommentForm violationId={violation.id} /> : null}
      </SectionCard>

      <SectionCard title="Status history" description="Complete audit trail of every status change.">
        <ul className="space-y-2">
          {violation.statusHistory.map((h) => (
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
        <Link href="/hoa/violations" className="font-semibold text-emerald-700 hover:underline">← Back to Violations</Link>
      </p>
    </main>
  );
}
