import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import {
  listPtaVolunteerOpportunities,
  listPendingPtaVolunteerHourEntries,
  listPtaUnderstaffedSlots,
  getPtaVolunteerRequirement,
} from "@/lib/labs/pta/volunteers";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { CreateOpportunityForm } from "@/components/labs/pta/CreateOpportunityForm";
import { VolunteerRequirementForm } from "@/components/labs/pta/VolunteerRequirementForm";

const OPPORTUNITY_STATUS_TONE: Record<string, string> = {
  DRAFT: "unknown",
  OPEN: "healthy",
  CLOSED: "warning",
  COMPLETED: "info",
  CANCELLED: "critical",
  ARCHIVED: "unknown",
};

export default async function PtaManageVolunteersPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:volunteers:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Manage Volunteers" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  const schoolYear = profile?.currentSchoolYear ?? null;
  const canApproveHours = can("pta:volunteer-hours:approve");

  const [opportunities, pendingApprovals, understaffed, requirement] = await Promise.all([
    listPtaVolunteerOpportunities(organizationId, schoolYear ? { schoolYear } : {}),
    canApproveHours ? listPendingPtaVolunteerHourEntries(organizationId, schoolYear ? { schoolYear } : {}) : Promise.resolve([]),
    listPtaUnderstaffedSlots(organizationId),
    schoolYear ? getPtaVolunteerRequirement(organizationId, schoolYear) : Promise.resolve(null),
  ]);

  const openCount = opportunities.filter((o) => o.status === "OPEN").length;
  const confirmedVolunteers = opportunities.reduce((sum, o) => sum + o.slots.reduce((s, slot) => s + slot.signups.length, 0), 0);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Manage Volunteers"
        description="Create opportunities and shifts. Parents claim shifts from the Volunteer Opportunities page; check-in, attendance, and hour approval happen on each opportunity's own page."
        actions={canApproveHours ? [{ href: "/labs/pta/volunteers/approvals", label: "Hour approval queue", tone: "primary" }] : []}
      />

      <SectionCard title="Overview">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Open opportunities" value={openCount} />
          <StatCard label="Confirmed volunteers" value={confirmedVolunteers} />
          <StatCard label="Pending hour approvals" value={pendingApprovals.length} />
          <StatCard label="Understaffed shifts" value={understaffed.length} />
        </div>
      </SectionCard>

      {understaffed.length > 0 ? (
        <SectionCard title="Understaffed shifts" description="Below their informational minimum — not a hard limit, just a staffing signal.">
          <ul className="divide-y divide-slate-100">
            {understaffed.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <Link href={`/labs/pta/volunteers/manage/${s.opportunityId}`} className="font-medium text-emerald-700 hover:underline">
                    {s.opportunity.title}
                  </Link>
                  <span className="text-slate-600"> — {s.label ?? "shift"}</span>
                </span>
                <span className="text-slate-600">{s.claimedCount}/{s.minNeeded} minimum</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {schoolYear ? (
        <SectionCard title="Family volunteer-hour goal" description="Optional — leave unconfigured if this PTA doesn't require hours.">
          <VolunteerRequirementForm
            schoolYear={schoolYear}
            initialRequiredHours={requirement ? requirement.requiredMinutes / 60 : null}
            initialActive={requirement?.active ?? false}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Post an opportunity">
        <CreateOpportunityForm />
      </SectionCard>

      <SectionCard title="All opportunities" description={`${opportunities.length} opportunity(ies)${schoolYear ? ` for ${schoolYear}` : ""}.`}>
        {opportunities.length === 0 ? (
          <EmptyState title="No volunteer opportunities yet" description="Post your first opportunity above." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {opportunities.map((opp) => {
              const confirmed = opp.slots.reduce((s, slot) => s + slot.signups.length, 0);
              const capacity = opp.slots.reduce((s, slot) => s + slot.capacity, 0);
              return (
                <li key={opp.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/labs/pta/volunteers/manage/${opp.id}`} className="font-semibold text-emerald-700 hover:underline">
                      {opp.title}
                    </Link>
                    <p className="text-sm text-slate-600">
                      {opp.slots.length} shift(s) · {confirmed}/{capacity} filled
                      {opp.committee ? ` · ${opp.committee.name}` : ""}
                    </p>
                  </div>
                  <StatusPill status={OPPORTUNITY_STATUS_TONE[opp.status] ?? "unknown"} label={opp.status} />
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </main>
  );
}
