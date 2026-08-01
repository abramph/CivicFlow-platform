import { requireOrganization } from "@/lib/auth-guards";
import { checkPtaVerticalAvailable } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { listPtaVolunteerOpportunities, getPtaVolunteerHourTotalsForHousehold, listPtaVolunteerCommitments } from "@/lib/labs/pta/volunteers";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { EmptyState, StatusPill } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { VolunteerSlotClaimButton } from "@/components/labs/pta/VolunteerSlotClaimButton";
import { formatDateTime } from "@/lib/formatting";

const COMMITMENT_STATUS_TONE: Record<string, string> = {
  SIGNED_UP: "healthy",
  CANCELLED: "unknown",
  ATTENDED: "healthy",
  PARTIAL: "warning",
  NO_SHOW: "critical",
  EXCUSED: "info",
  COMPLETED: "healthy",
  WAITLISTED: "warning",
};

function minutesToHours(minutes: number): string {
  return (minutes / 60).toFixed(1).replace(/\.0$/, "");
}

export default async function PtaVolunteersPage() {
  const { organizationId, session, can } = await requireOrganization();
  const access = await checkPtaVerticalAvailable(organizationId);

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Opportunities" description="Not available for this organization." />
      </main>
    );
  }

  const [opportunities, adult, profile] = await Promise.all([
    listPtaVolunteerOpportunities(organizationId, { status: "OPEN" }),
    prisma.ptaHouseholdAdult.findFirst({ where: { organizationId, userId: session.userId } }),
    getPtaProfile(organizationId),
  ]);

  const schoolYear = profile?.currentSchoolYear ?? null;
  const [totals, commitments] = await Promise.all([
    adult?.householdId && schoolYear ? getPtaVolunteerHourTotalsForHousehold(organizationId, adult.householdId, schoolYear) : Promise.resolve(null),
    adult ? listPtaVolunteerCommitments(organizationId, adult.id) : Promise.resolve([]),
  ]);
  const pastCommitments = commitments.filter((c) => c.status !== "SIGNED_UP" && c.status !== "CANCELLED");
  const upcomingCommitments = commitments.filter((c) => c.status === "SIGNED_UP");

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Volunteer Opportunities"
        description="Browse open opportunities and claim an available time slot."
        actions={can("pta:volunteers:manage") ? [{ href: "/labs/pta/volunteers/manage", label: "Manage opportunities" }] : []}
      />

      {totals ? (
        <SectionCard title="Family volunteer goal" description={`School year ${schoolYear}.`}>
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard label="Approved volunteer hours" value={minutesToHours(totals.approvedMinutes)} />
            <StatCard label="Hours awaiting approval" value={minutesToHours(totals.pendingMinutes)} />
            {totals.requiredMinutes != null ? (
              <StatCard label="Remaining toward goal" value={minutesToHours(totals.remainingMinutes ?? 0)} helper={`Goal: ${minutesToHours(totals.requiredMinutes)} hours`} />
            ) : (
              <StatCard label="Family goal" value="Not required" helper="This PTA doesn't require a set number of hours." />
            )}
          </div>
        </SectionCard>
      ) : null}

      {upcomingCommitments.length > 0 ? (
        <SectionCard title="My signups">
          <ul className="divide-y divide-slate-100">
            {upcomingCommitments.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {c.slot.opportunity.title} — {c.slot.label ?? "shift"}
                </span>
                <StatusPill status="healthy" label="Signed up" />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {pastCommitments.length > 0 ? (
        <SectionCard title="My completed service">
          <ul className="divide-y divide-slate-100">
            {pastCommitments.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p>{c.slot.opportunity.title} — {c.slot.label ?? "shift"}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(c.updatedAt)}</p>
                </div>
                <StatusPill status={COMMITMENT_STATUS_TONE[c.status] ?? "unknown"} label={c.status.replace("_", " ")} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

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
