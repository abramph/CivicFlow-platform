import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { computeReadiness, getOrgReadinessFacts, getTransitionDetail, listTransitions } from "@/lib/labs/pta/transitions";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaTransitionCenter } from "@/components/labs/pta/PtaTransitionCenter";

/**
 * PTA Vertical 2.0, PR PTA-F — the Board Transition Center (signature
 * feature, docs/pta-vertical-2.md PTA-F): structured year-over-year board
 * handoff with readiness scoring and the downloadable transition packet.
 */
export default async function PtaTransitionPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:board:view");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Transition Center" description="Not available for this organization." />
      </main>
    );
  }

  const [transitions, yearContext] = await Promise.all([listTransitions(organizationId), getSchoolYearContext(organizationId)]);

  // The working transition: newest one that is not yet completed.
  const active = transitions.find((transition) => transition.status !== "COMPLETED") ?? null;
  let detail = null;
  let readiness = null;
  let incomingAssignments: { id: string; positionId: string; name: string }[] = [];
  if (active) {
    detail = await getTransitionDetail(organizationId, active.id);
    readiness = computeReadiness(detail, await getOrgReadinessFacts(organizationId));
    const incoming = await prisma.ptaOfficerAssignment.findMany({
      where: { organizationId, status: "INCOMING" },
      include: { householdAdult: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    incomingAssignments = incoming.map((assignment) => ({
      id: assignment.id,
      positionId: assignment.positionId,
      name: assignment.householdAdult?.name ?? assignment.personName ?? "Unnamed",
    }));
  }

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Transition Center"
        description="Hand the board from one school year to the next: position-by-position checklists, incoming officers, a readiness score, and a downloadable transition packet. Unestra never stores passwords — credential handoff is a checklist you confirm, not data you enter."
      />
      <SectionCard
        title={active && detail ? `Board transition ${detail.fromSchoolYear.label} → ${detail.toSchoolYear.label}` : "Start a transition"}
        description={
          active
            ? "Work the handoffs below; complete the transition when every position is accepted."
            : "Starting a transition creates a handoff checklist for every active board position."
        }
      >
        <PtaTransitionCenter
          canManage={can("pta:board:manage")}
          currentYearLabel={yearContext.current?.label ?? null}
          nextYearLabel={yearContext.suggestedNextLabel}
          detail={
            detail && readiness
              ? {
                  id: detail.id,
                  status: detail.status,
                  notes: detail.notes,
                  fromYear: detail.fromSchoolYear.label,
                  toYear: detail.toSchoolYear.label,
                  readiness,
                  handoffs: detail.handoffs
                    .sort((a, b) => a.position.sortOrder - b.position.sortOrder)
                    .map((handoff) => ({
                      id: handoff.id,
                      positionName: handoff.position.name,
                      positionId: handoff.position.id,
                      status: handoff.status,
                      notes: handoff.notes,
                      acceptedAt: handoff.acceptedAt?.toISOString() ?? null,
                      outgoingName: handoff.outgoingAssignment
                        ? handoff.outgoingAssignment.householdAdult?.name ?? handoff.outgoingAssignment.personName ?? "Unnamed"
                        : null,
                      incomingAssignmentId: handoff.incomingAssignmentId,
                      incomingName: handoff.incomingAssignment
                        ? handoff.incomingAssignment.householdAdult?.name ?? handoff.incomingAssignment.personName ?? "Unnamed"
                        : null,
                      checklistItems: handoff.checklistItems.map((item) => ({
                        id: item.id,
                        title: item.title,
                        description: item.description,
                        isRequired: item.isRequired,
                        completedAt: item.completedAt?.toISOString() ?? null,
                      })),
                    })),
                }
              : null
          }
          incomingAssignments={incomingAssignments}
          history={transitions
            .filter((transition) => transition.status === "COMPLETED")
            .map((transition) => ({
              id: transition.id,
              fromYear: transition.fromSchoolYear.label,
              toYear: transition.toSchoolYear.label,
            }))}
        />
      </SectionCard>
    </main>
  );
}
