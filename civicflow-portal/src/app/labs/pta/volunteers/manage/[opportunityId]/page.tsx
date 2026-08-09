import Link from "next/link";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { OpportunityStatusButtons } from "@/components/labs/pta/OpportunityStatusButtons";
import { EditOpportunityForm } from "@/components/labs/pta/EditOpportunityForm";
import { DuplicateOpportunityButton } from "@/components/labs/pta/DuplicateOpportunityButton";
import { ShiftForm } from "@/components/labs/pta/ShiftForm";
import { EditSlotForm } from "@/components/labs/pta/EditSlotForm";
import { ConfirmActionButton } from "@/components/labs/pta/ConfirmActionButton";
import { ManualAssignVolunteerForm } from "@/components/labs/pta/ManualAssignVolunteerForm";
import { SignupAttendanceControls } from "@/components/labs/pta/SignupAttendanceControls";
import { formatDateTime } from "@/lib/formatting";

const OPPORTUNITY_STATUS_TONE: Record<string, string> = {
  DRAFT: "unknown",
  OPEN: "healthy",
  CLOSED: "warning",
  COMPLETED: "info",
  CANCELLED: "critical",
  ARCHIVED: "unknown",
};

const SIGNUP_STATUS_TONE: Record<string, string> = {
  SIGNED_UP: "healthy",
  WAITLISTED: "warning",
  CANCELLED: "unknown",
  ATTENDED: "healthy",
  PARTIAL: "warning",
  NO_SHOW: "critical",
  EXCUSED: "info",
  COMPLETED: "healthy",
};

export default async function PtaVolunteerOpportunityDetailPage({ params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const { organizationId, access, can } = await getPtaPageGate("pta:volunteers:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Opportunity" description="Not available for this organization." />
      </main>
    );
  }

  const [opportunity, events] = await Promise.all([
    getPtaVolunteerOpportunity(organizationId, opportunityId),
    prisma.event.findMany({ where: { organizationId }, select: { id: true, title: true, startAt: true }, orderBy: { startAt: "desc" }, take: 100 }),
  ]);
  const canCheckIn = can("pta:volunteers:checkin");

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/volunteers/manage", label: "Manage Volunteers" }, { label: opportunity.title }]} />
      <PageHeader
        title={opportunity.title}
        description={opportunity.description ?? undefined}
        actions={[{ href: "/labs/pta/volunteers/manage", label: "Back to all opportunities" }]}
      />

      <SectionCard title="Status">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusPill status={OPPORTUNITY_STATUS_TONE[opportunity.status] ?? "unknown"} label={opportunity.status} />
          {opportunity.committee ? <span className="text-sm text-slate-600">Committee: {opportunity.committee.name}</span> : null}
          {opportunity.event ? (
            <span className="text-sm text-slate-600">
              Event: <Link href={`/events/${opportunity.event.id}`} className="text-emerald-700 hover:underline">{opportunity.event.title}</Link>
              {opportunity.event.startAt ? ` (${formatDateTime(opportunity.event.startAt)})` : ""}
            </span>
          ) : null}
          {opportunity.signupDeadline ? <span className="text-sm text-slate-600">Signup deadline: {formatDateTime(opportunity.signupDeadline)}</span> : null}
          {opportunity.cancellationDeadline ? <span className="text-sm text-slate-600">Cancellation deadline: {formatDateTime(opportunity.cancellationDeadline)}</span> : null}
        </div>
        {opportunity.instructions ? <p className="mb-3 text-sm text-slate-700">Instructions: {opportunity.instructions}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <OpportunityStatusButtons opportunityId={opportunity.id} currentStatus={opportunity.status} />
          <EditOpportunityForm
            opportunityId={opportunity.id}
            initialTitle={opportunity.title}
            initialEventId={opportunity.event?.id ?? null}
            initialDescription={opportunity.description}
            initialInstructions={opportunity.instructions}
            initialCancellationDeadline={opportunity.cancellationDeadline?.toISOString() ?? null}
            initialSignupDeadline={opportunity.signupDeadline?.toISOString() ?? null}
            events={events}
          />
          <DuplicateOpportunityButton opportunityId={opportunity.id} />
        </div>
      </SectionCard>

      <SectionCard title="Shifts" description="Each shift is a specific time window with its own capacity and volunteers.">
        {opportunity.slots.length === 0 ? (
          <EmptyState title="No shifts yet" description="Add your first shift below." />
        ) : (
          <div className="mb-4 space-y-4">
            {opportunity.slots.map((slot) => {
              const full = slot.claimedCount >= slot.capacity;
              return (
                <div key={slot.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{slot.label ?? "Time slot"}</p>
                      <p className="text-xs text-slate-600">
                        {slot.claimedCount}/{slot.capacity} filled
                        {slot.minNeeded ? ` · needs at least ${slot.minNeeded}` : ""}
                        {slot.locationOverride ? ` · ${slot.locationOverride}` : ""}
                      </p>
                    </div>
                    <StatusPill status={full ? "warning" : "healthy"} label={full ? "Full" : "Open seats"} />
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <EditSlotForm
                      slotId={slot.id}
                      initialLabel={slot.label}
                      initialCapacity={slot.capacity}
                      initialMinNeeded={slot.minNeeded}
                      initialLocationOverride={slot.locationOverride}
                      claimedCount={slot.claimedCount}
                    />
                    {slot.claimedCount === 0 ? (
                      <ConfirmActionButton label="Delete shift" confirmLabel="Delete" method="DELETE" url={`/api/labs/pta/volunteers/slots/${slot.id}`} />
                    ) : null}
                  </div>

                  {slot.signups.length === 0 ? (
                    <p className="mb-2 text-xs text-slate-500">No one signed up yet.</p>
                  ) : (
                    <ul className="mb-3 divide-y divide-slate-100">
                      {slot.signups.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                          <div>
                            <span className="font-medium text-slate-900">{s.householdAdult.name}</span>
                            <StatusPill status={SIGNUP_STATUS_TONE[s.status] ?? "unknown"} label={s.status.replace("_", " ")} />
                            {s.manuallyAssigned ? <span className="ml-2 text-xs text-slate-500">(assigned by officer)</span> : null}
                          </div>
                          {s.status !== "CANCELLED" ? (
                            <div className="flex flex-wrap items-center gap-2">
                              {canCheckIn ? (
                                <SignupAttendanceControls
                                  signupId={s.id}
                                  checkInAt={s.attendance?.checkInAt?.toISOString() ?? null}
                                  checkOutAt={s.attendance?.checkOutAt?.toISOString() ?? null}
                                  attendanceStatus={s.attendance?.status ?? null}
                                />
                              ) : null}
                              <ConfirmActionButton
                                label="Remove"
                                confirmLabel="Remove"
                                method="POST"
                                url={`/api/labs/pta/volunteers/slots/${slot.id}/officer-cancel`}
                                body={{ householdAdultId: s.householdAdult.id }}
                              />
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ManualAssignVolunteerForm slotId={slot.id} isFull={full} />
                </div>
              );
            })}
          </div>
        )}
        <ShiftForm opportunityId={opportunity.id} />
      </SectionCard>
    </main>
  );
}
