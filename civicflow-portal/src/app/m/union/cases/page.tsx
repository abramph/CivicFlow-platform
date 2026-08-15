import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { listMyUnionCases } from "@/lib/union/cases-guard";
import { toMemberSafeUnionCase } from "@/lib/union/cases";
import { EmptyState } from "@/components/admin/OperationsUI";
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

/**
 * "My Cases" -- a member's own submitted issues/grievances, in the active
 * organization. Web counterpart to the officer-facing /union/cases pages;
 * the native mobile app is API-ready (GET /api/union/cases/my) but doesn't
 * yet have its own screen -- same reduced-mobile-scope reasoning as
 * /m/architectural-requests and /m/violations (this is a member self-
 * service surface intentionally kept web-first for now).
 */
export default async function MemberUnionCasesPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="union-cases" title="My Cases" />
      </div>
    );
  }

  const cases = await listMyUnionCases(memberSession.organizationId);
  const safeCases = cases.map((c) => toMemberSafeUnionCase(c));

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Cases</h1>
          <p className="mt-1 text-sm text-slate-600">Issues you&apos;ve raised with {memberSession.organizationName}.</p>
        </div>
        <Link href="/m/union/cases/new" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
          Get help
        </Link>
      </div>

      {safeCases.length === 0 ? (
        <EmptyState title="No cases yet" description="Tell us what happened and a steward will follow up with you." />
      ) : (
        <ul className="space-y-4">
          {safeCases.map((c) => (
            <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <Link href={`/m/union/cases/${c.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">
                    UC-{c.caseNumber} · {c.title}
                  </h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Submitted {formatDateTime(c.createdAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        <Link href="/dashboard" className="font-semibold text-emerald-700 hover:underline">
          ← Back
        </Link>
      </p>
    </main>
  );
}
