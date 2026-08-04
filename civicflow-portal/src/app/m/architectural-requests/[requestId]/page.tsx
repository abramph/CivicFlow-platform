import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { requireArchitecturalRequestResidentAccess } from "@/lib/hoa/architectural-requests-guard";
import { toResidentSafeArchitecturalRequest } from "@/lib/hoa/architectural-requests";
import { prisma } from "@/lib/prisma";
import { ResidentArchitecturalRequestActions } from "@/components/hoa/ResidentArchitecturalRequestActions";
import { formatDateTime } from "@/lib/formatting";

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

export default async function MemberArchitecturalRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="architectural-requests" title="Architectural Requests" />
      </div>
    );
  }

  const { requestId } = await params;
  try {
    await requireArchitecturalRequestResidentAccess(memberSession.organizationId, requestId);
  } catch {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <p className="text-sm text-slate-600">This request isn&apos;t available.</p>
        <p className="text-sm">
          <Link href="/m/architectural-requests" className="font-semibold text-emerald-700 hover:underline">← Back</Link>
        </p>
      </main>
    );
  }

  const request = await prisma.architecturalRequest.findFirst({
    where: { id: requestId, organizationId: memberSession.organizationId },
    include: { comments: { orderBy: { createdAt: "desc" } } },
  });
  const safe = toResidentSafeArchitecturalRequest(request!);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AR-{safe.requestNumber} · {safe.title}</h1>
        <p className="mt-1 text-sm text-slate-600">{safe.category}</p>
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
          {STATUS_LABELS[safe.status] ?? safe.status}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-800">{safe.projectDescription}</p>
        {safe.proposedStartDate ? <p className="mt-2 text-xs text-slate-500">Proposed start: {formatDateTime(safe.proposedStartDate)}</p> : null}
        {safe.proposedCompletionDate ? <p className="mt-1 text-xs text-slate-500">Proposed completion: {formatDateTime(safe.proposedCompletionDate)}</p> : null}
      </div>

      {safe.decisionSummary ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Board decision</p>
          <p className="mt-1 text-sm text-slate-900">{safe.decisionSummary}</p>
          {safe.conditions ? (
            <>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-700">Conditions</p>
              <p className="mt-1 text-sm text-amber-900">{safe.conditions}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Manage this request</h2>
        <div className="mt-3">
          <ResidentArchitecturalRequestActions requestId={safe.id} organizationId={memberSession.organizationId} status={safe.status} />
        </div>
      </div>

      {safe.comments.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Comments from the board</h2>
          <ul className="mt-3 space-y-3">
            {safe.comments.map((c) => (
              <li key={c.id} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm text-slate-800">{c.body}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(c.createdAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-sm">
        <Link href="/m/architectural-requests" className="font-semibold text-emerald-700 hover:underline">← Back</Link>
      </p>
    </main>
  );
}
