import { requireOrganization } from "@/lib/auth-guards";
import { getOrganizationLabAccess } from "@/lib/labs/access";
import { prisma } from "@/lib/prisma";
import { listPtaVolunteerOpportunities } from "@/lib/labs/pta/volunteers";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { VolunteerSlotClaimButton } from "@/components/labs/pta/VolunteerSlotClaimButton";

export default async function PtaVolunteersPage() {
  const { organizationId, session, can } = await requireOrganization();
  const access = await getOrganizationLabAccess(organizationId, "ptaVertical");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Opportunities" description="Not available for this organization." />
      </main>
    );
  }

  const [opportunities, adult] = await Promise.all([
    listPtaVolunteerOpportunities(organizationId, { status: "OPEN" }),
    prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, userId: session.userId } }),
  ]);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Volunteer Opportunities"
        description="Browse open opportunities and claim an available time slot."
        actions={can("pta:volunteers:manage") ? [{ href: "/labs/pta/volunteers/manage", label: "Manage opportunities" }] : []}
      />

      {opportunities.length === 0 ? (
        <EmptyState title="No open volunteer opportunities right now" />
      ) : (
        opportunities.map((opp) => (
          <SectionCard key={opp.id} title={opp.title} description={opp.description ?? undefined}>
            {opp.supplyRequest ? <p className="mb-3 text-sm text-slate-700">Requested supplies: {opp.supplyRequest}</p> : null}
            <div className="space-y-2">
              {opp.slots.map((slot) => {
                const claimed = slot.signups.length;
                const full = claimed >= slot.capacity;
                const alreadySignedUp = adult ? slot.signups.some((s) => s.householdAdultId === adult.id) : false;
                return (
                  <div key={slot.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{slot.label ?? "Time slot"}</p>
                      <p className="text-xs text-slate-600">{claimed}/{slot.capacity} filled</p>
                    </div>
                    {adult ? (
                      <VolunteerSlotClaimButton slotId={slot.id} full={full} alreadySignedUp={alreadySignedUp} />
                    ) : (
                      <span className="text-xs text-slate-500">Link your account to a household to volunteer</span>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionCard>
        ))
      )}
    </main>
  );
}
