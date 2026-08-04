import Link from "next/link";
import { OpenInAppBanner } from "@/components/app/OpenInAppBanner";
import { getMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";
import { toResidentSafeViolation } from "@/lib/hoa/violations";
import { EmptyState } from "@/components/admin/OperationsUI";
import { formatDateTime } from "@/lib/formatting";

const STATUS_LABELS: Record<string, string> = {
  ISSUED: "Issued",
  ACKNOWLEDGED: "Acknowledged",
  IN_REVIEW: "In review",
  CURED: "Cured",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

/**
 * Resident self-service read path — every non-DRAFT violation on a
 * property the caller is an ACTIVE resident/owner of. Web counterpart to
 * the officer-facing /hoa/violations pages; the mobile app is
 * API-ready (GET /api/hoa/violations/my) but doesn't yet have its own
 * screen, per this MVP's deliberately reduced mobile scope (board-level
 * decision workflows stay desk-first; a resident READING their own
 * violation notices is a reasonable exception to build web-first here
 * rather than mobile-first, matching how /m/dues works today).
 */
export default async function MemberViolationsPage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const memberSession = await getMemberWebSession(org);

  if (!memberSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <OpenInAppBanner deepLink="violations" title="Violation Notices" />
      </div>
    );
  }

  const propertyRows = await prisma.propertyResident.findMany({
    where: { organizationId: memberSession.organizationId, orgMemberId: memberSession.memberId, status: "ACTIVE" },
    select: { propertyId: true },
  });
  const propertyIds = propertyRows.map((r) => r.propertyId);

  const violations = propertyIds.length
    ? await prisma.violation.findMany({
        where: { organizationId: memberSession.organizationId, propertyId: { in: propertyIds }, status: { not: "DRAFT" } },
        include: { notices: { orderBy: { sentAt: "desc" } }, comments: { orderBy: { createdAt: "desc" } } },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Violation Notices</h1>
        <p className="mt-1 text-sm text-slate-600">For every property you own or reside at with {memberSession.organizationName}.</p>
      </div>

      {violations.length === 0 ? (
        <EmptyState title="No violation notices" description="You have no active or past violation notices on file." />
      ) : (
        <ul className="space-y-4">
          {violations.map((v) => {
            const safe = toResidentSafeViolation(v);
            return (
              <li key={safe.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900">{safe.violationType}</h2>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-slate-700">
                    {STATUS_LABELS[safe.status] ?? safe.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-700">{safe.description}</p>
                {safe.cureByDate ? <p className="mt-1 text-xs text-slate-500">Cure by {formatDateTime(safe.cureByDate)}</p> : null}
                {safe.notices.length > 0 ? (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest notice</p>
                    <p className="mt-1 text-sm text-slate-800">{safe.notices[0].body}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm">
        <Link href="/dashboard" className="font-semibold text-emerald-700 hover:underline">← Back</Link>
      </p>
    </main>
  );
}
