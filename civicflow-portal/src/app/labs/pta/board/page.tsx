import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getBoardRoster } from "@/lib/labs/pta/board";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaBoardManager } from "@/components/labs/pta/PtaBoardManager";

/**
 * PTA Vertical 2.0, PR PTA-B — Board Officers. The roster (positions +
 * current holders), history-preserving assignment, incoming-officer prep,
 * and position management. Uses PTA language throughout ("Board Officers",
 * never model names) per the program's UX principle.
 */
export default async function PtaBoardPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:board:view");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Board Officers" description="Not available for this organization." />
      </main>
    );
  }

  const [roster, years, adults] = await Promise.all([
    getBoardRoster(organizationId),
    getSchoolYearContext(organizationId),
    prisma.ptaHouseholdAdult.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Board Officers"
        description="Your board's positions, who holds them, and the complete leadership history. Assigning a successor never erases who served before."
      />
      <SectionCard
        title={`Board roster${years.current ? ` — ${years.current.label}` : ""}`}
        description="Officers and board members. Use History on any position to see every past holder."
      >
        <PtaBoardManager
          roster={roster.map((position) => ({
            id: position.id,
            name: position.name,
            description: position.description,
            classification: position.classification,
            isVoting: position.isVoting,
            currentAssignment: position.currentAssignment
              ? {
                  id: position.currentAssignment.id,
                  holderName: position.currentAssignment.holderName,
                  schoolYearLabel: position.currentAssignment.schoolYearLabel,
                  startDate: position.currentAssignment.startDate?.toISOString() ?? null,
                }
              : null,
          }))}
          adults={adults}
          years={years.years.map((year) => ({ id: year.id, label: year.label, isCurrent: year.isCurrent }))}
          canManage={can("pta:board:manage")}
        />
      </SectionCard>
    </main>
  );
}
