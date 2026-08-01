import { requireOrganization } from "@/lib/auth-guards";
import { checkPtaVerticalAvailable } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { getPtaHousehold } from "@/lib/labs/pta/households";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";

/**
 * Parent self-service page. Deliberately does NOT use getPtaPageGate (which
 * requires a staff Permission) — a plain MEMBER-role parent must be able to
 * reach this page. Resolves the household strictly from the caller's own
 * linked PtaHouseholdAdult.userId, never from a URL parameter, so one
 * household can never see another's page by guessing/changing an id.
 */
export default async function PtaMyHouseholdPage() {
  const { organizationId, session } = await requireOrganization();
  const access = await checkPtaVerticalAvailable(organizationId);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="My Household" description="Not available for this organization." />
      </main>
    );
  }

  const adult = await prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, userId: session.userId } });
  if (!adult) {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="My Household" />
        <EmptyState title="No linked household" description="Your account isn't linked to a PTA household yet — contact your PTA officer." />
      </main>
    );
  }

  const household = await getPtaHousehold(organizationId, adult.householdId);

  if (household.status !== "ACTIVE") {
    return (
      <main className="space-y-6">
        <PtaLabsBadge />
        <PageHeader title="My Household" />
        <EmptyState title="Household not active" description="Your household's PTA membership is not currently active — contact your PTA officer." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader title={household.displayName} description={`School year ${household.schoolYear}.`} />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Adults" value={household.adults.length} />
        <StatCard label="Students" value={household.students.filter((s) => s.status === "ACTIVE").length} />
        <StatCard label="Membership status" value={household.status} />
      </div>

      <SectionCard title="Household adults">
        <ul className="divide-y divide-slate-100">
          {household.adults.map((a) => (
            <li key={a.id} className="py-2 text-sm text-slate-900">
              {a.name} {a.relationshipLabel ? <span className="text-slate-500">({a.relationshipLabel})</span> : null}
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard title="Students">
        {household.students.length === 0 ? (
          <EmptyState title="No students on file" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {household.students.map((s) => (
              <li key={s.id} className="py-2 text-sm text-slate-900">
                {s.displayName} <span className="text-slate-500">({s.status.toLowerCase()})</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
