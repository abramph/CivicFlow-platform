import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { requireUnionCaseMemberAccess } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase } from "@/lib/union/cases";
import { prisma } from "@/lib/prisma";
import { UnionCaseMemberActions } from "@/components/union/UnionCaseMemberActions";
import { formatDateTime } from "@/lib/formatting";

const STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  TRIAGE: "Under review",
  ASSIGNED: "Assigned",
  ACTIVE: "In progress",
  PENDING: "Waiting",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn",
};

export default async function MemberUnionCaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ org?: string }>;
}) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="union-cases" title="My Cases" />
      </div>
    );
  }

  const { caseId } = await params;
  try {
    await requireUnionCaseMemberAccess(memberSession.organizationId, caseId);
  } catch {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <p className="text-sm text-slate-600">This case isn&apos;t available.</p>
        <p className="text-sm">
          <Link href="/m/union/cases" className="font-semibold text-emerald-700 hover:underline">
            ← Back to My Cases
          </Link>
        </p>
      </main>
    );
  }

  // requireUnionCaseMemberAccess() already confirmed this row exists and
  // belongs to the caller; re-fetching here is just to pick up the
  // comments/deadlines includes toMemberSafeUnionCase filters.
  const unionCase = await prisma.unionCase.findFirst({
    where: { id: caseId, organizationId: memberSession.organizationId },
    include: { comments: { orderBy: { createdAt: "desc" } }, deadlines: { orderBy: { dueAt: "asc" } } },
  });
  const safe = toMemberSafeUnionCase(unionCase!);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          UC-{safe.caseNumber} · {safe.title}
        </h1>
        <span className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
          {STATUS_LABELS[safe.status] ?? safe.status}
        </span>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-800">{safe.description}</p>
        <p className="mt-2 text-xs text-slate-500">Submitted {formatDateTime(safe.createdAt)}</p>
        {safe.incidentDate ? <p className="text-xs text-slate-500">Date it happened: {formatDateTime(safe.incidentDate)}</p> : null}
      </div>

      {safe.resolutionSummary ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</p>
          <p className="mt-1 text-sm text-slate-900">{safe.resolutionSummary}</p>
        </div>
      ) : null}

      {safe.upcomingDates.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Upcoming dates</h2>
          <ul className="mt-3 space-y-2">
            {safe.upcomingDates.map((d) => (
              <li key={d.id} className="text-sm text-slate-800">
                {formatDateTime(d.dueAt)}
                {d.description ? ` — ${d.description}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Manage this case</h2>
        <div className="mt-3">
          <UnionCaseMemberActions caseId={safe.id} organizationId={memberSession.organizationId} status={safe.status} />
        </div>
      </div>

      {safe.comments.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Updates</h2>
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
        <Link href="/m/union/cases" className="font-semibold text-emerald-700 hover:underline">
          ← Back to My Cases
        </Link>
      </p>
    </main>
  );
}
