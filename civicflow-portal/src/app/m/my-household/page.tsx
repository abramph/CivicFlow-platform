import { requireOrganization } from "@/lib/auth-guards";
import { checkPtaVerticalAvailable } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getPtaHousehold } from "@/lib/labs/pta/households";
import { EmptyState } from "@/components/admin/OperationsUI";

/**
 * Member-portal counterpart to /labs/pta/my-household. A pure PTA household
 * parent has no OrganizationMembership/OrgMember record at all (role MEMBER,
 * memberId null), so PortalShell renders the staff shell's children bare for
 * them — this page lives under /m/ instead, so MemberPortalShell's nav and
 * logout button are actually present. Resolves the household strictly from
 * the caller's own linked PtaHouseholdAdult.userId, never from a URL
 * parameter, so one household can never see another's page.
 */
export default async function MemberHouseholdPage() {
  const { organizationId, session } = await requireOrganization();
  const access = await checkPtaVerticalAvailable(organizationId);

  if (!access.available) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-bold text-slate-900">My Household</h1>
        <p className="text-sm text-slate-600">Not available for this organization.</p>
      </main>
    );
  }

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, userId: session.userId } });
  if (!adult) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-bold text-slate-900">My Household</h1>
        <EmptyState title="No linked household" description="Your account isn't linked to a PTA household yet — contact your PTA officer." />
      </main>
    );
  }

  const household = await getPtaHousehold(organizationId, adult.householdId);

  if (household.status !== "ACTIVE") {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-bold text-slate-900">My Household</h1>
        <EmptyState title="Household not active" description="Your household's PTA membership is not currently active — contact your PTA officer." />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{household.displayName}</h1>
        <p className="mt-1 text-sm text-slate-600">School year {household.schoolYear}.</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Household adults</h2>
        <ul className="mt-2 divide-y divide-slate-100">
          {household.adults.map((a) => (
            <li key={a.id} className="py-2 text-sm text-slate-900">
              {a.name} {a.relationshipLabel ? <span className="text-slate-500">({a.relationshipLabel})</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Students</h2>
        {household.students.length === 0 ? (
          <EmptyState title="No students on file" />
        ) : (
          <ul className="mt-2 divide-y divide-slate-100">
            {household.students.map((s) => (
              <li key={s.id} className="py-2 text-sm text-slate-900">
                {s.displayName} <span className="text-slate-500">({s.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
