import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { listMyArchitecturalRequests } from "@/lib/hoa/architectural-requests-guard";
import { toResidentSafeArchitecturalRequest } from "@/lib/hoa/architectural-requests";
import { EmptyState } from "@/components/admin/OperationsUI";
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

/**
 * Resident self-service list -- every request the caller has ever
 * submitted, in the active organization. Web counterpart to the
 * officer-facing /hoa/architectural-requests pages; the mobile app is
 * API-ready but doesn't yet have its own screen, same reduced mobile
 * scope reasoning as /m/violations (board/committee-level decisions stay
 * desk-first; a resident tracking their own submission is a reasonable
 * exception to build web-first here too).
 */
export default async function MemberArchitecturalRequestsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="architectural-requests" title="Architectural Requests" />
      </div>
    );
  }

  const requests = await listMyArchitecturalRequests(memberSession.organizationId);
  const safeRequests = requests.map(toResidentSafeArchitecturalRequest);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Architectural Requests</h1>
          <p className="mt-1 text-sm text-slate-600">Your submissions to {memberSession.organizationName}.</p>
        </div>
        <Link
          href="/m/architectural-requests/new"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          New request
        </Link>
      </div>

      {safeRequests.length === 0 ? (
        <EmptyState title="No architectural requests yet" description="Submit a request for board or committee approval of an exterior or property modification." />
      ) : (
        <ul className="space-y-4">
          {safeRequests.map((r) => (
            <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <Link href={`/m/architectural-requests/${r.id}`} className="block">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">AR-{r.requestNumber} · {r.title}</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
                    {STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{r.category}</p>
                <p className="mt-1 text-xs text-slate-500">Last updated {formatDateTime(r.updatedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm">
        <Link href="/dashboard" className="font-semibold text-emerald-700 hover:underline">← Back</Link>
      </p>
    </main>
  );
}
