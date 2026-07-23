import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listPtaVolunteerOpportunities } from "@/lib/labs/pta/volunteers";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { CreateOpportunityForm } from "@/components/labs/pta/CreateOpportunityForm";
import { AddSlotForm } from "@/components/labs/pta/AddSlotForm";
import { CompleteSignupButton } from "@/components/labs/pta/CompleteSignupButton";

export default async function PtaManageVolunteersPage() {
  const { organizationId, access } = await getPtaPageGate("pta:volunteers:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Manage Volunteers" description="Not available for this organization." />
      </main>
    );
  }

  const opportunities = await listPtaVolunteerOpportunities(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Manage Volunteers"
        description="Create opportunities and time slots — parents claim slots from the Volunteer Opportunities page. Completed signups here are logged hours, not event check-in/attendance (see docs/pta-labs-mvp.md's known limitations)."
      />

      <SectionCard title="Post an opportunity">
        <CreateOpportunityForm />
      </SectionCard>

      <SectionCard title="All opportunities" description={`${opportunities.length} opportunity(ies).`}>
        {opportunities.length === 0 ? (
          <EmptyState title="No volunteer opportunities yet" description="Post your first opportunity above." />
        ) : (
          <div className="space-y-4">
            {opportunities.map((opp) => (
              <div key={opp.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{opp.title}</p>
                    {opp.description ? <p className="text-sm text-slate-600">{opp.description}</p> : null}
                  </div>
                  <StatusPill status={opp.status === "OPEN" ? "healthy" : "unknown"} label={opp.status} />
                </div>
                <div className="mb-3 space-y-2">
                  {opp.slots.length === 0 ? (
                    <p className="text-sm text-slate-500">No time slots yet.</p>
                  ) : (
                    opp.slots.map((slot) => (
                      <div key={slot.id} className="rounded-lg bg-slate-50 p-3">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-900">{slot.label ?? "Time slot"}</span>
                          <span className="text-xs text-slate-600">{slot.signups.length}/{slot.capacity} filled</span>
                        </div>
                        {slot.signups.length > 0 ? (
                          <ul className="space-y-1">
                            {slot.signups.map((s) => (
                              <li key={s.id} className="flex items-center justify-between text-xs text-slate-700">
                                <span>{s.householdAdult.name}</span>
                                <CompleteSignupButton signupId={s.id} />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
                <AddSlotForm opportunityId={opp.id} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
