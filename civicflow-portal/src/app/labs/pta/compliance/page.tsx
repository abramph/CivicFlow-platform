import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listComplianceRequirements } from "@/lib/labs/pta/compliance";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaComplianceCalendar } from "@/components/labs/pta/PtaComplianceCalendar";

/**
 * PTA Vertical 2.0, PR PTA-I — the compliance calendar (brief §22). All
 * requirements are org-configured; nothing is assumed to apply universally.
 */
export default async function PtaCompliancePage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:board:view");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Compliance" description="Not available for this organization." />
      </main>
    );
  }

  const requirements = await listComplianceRequirements(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Compliance"
        description="Everything your PTA has to file, renew, and review — with owners, due dates, and recurrence. Requirements are yours to configure; nothing here is assumed to apply to every PTA/PTO."
      />
      <SectionCard title="Compliance calendar" description="Marking a recurring item complete advances its due date automatically.">
        <PtaComplianceCalendar
          requirements={requirements.map((row) => ({
            id: row.id,
            title: row.title,
            ownerName: row.ownerName,
            dueDate: row.dueDate?.toISOString() ?? null,
            recurrence: row.recurrence,
            isApplicable: row.isApplicable,
            lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
            displayStatus: row.displayStatus,
            notes: row.notes,
          }))}
          canManage={can("pta:board:manage")}
        />
      </SectionCard>
    </main>
  );
}
