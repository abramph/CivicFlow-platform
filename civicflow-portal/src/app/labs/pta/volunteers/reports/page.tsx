import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getVolunteerReport } from "@/lib/labs/pta/volunteer-reports";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaVolunteerReports } from "@/components/labs/pta/PtaVolunteerReports";

/**
 * PTA Vertical 2.0, PR PTA-G — volunteer reports (brief §16) + the reminder
 * "send now" control. Officer-only: most-active volunteers is a coordination
 * tool behind pta:volunteers:manage, never a public ranking.
 */
export default async function PtaVolunteerReportsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:volunteers:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Reports" description="Not available for this organization." />
      </main>
    );
  }

  const report = await getVolunteerReport(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Volunteer Reports"
        description={`Approved volunteer hours${report.schoolYear ? ` for ${report.schoolYear}` : ""}, staffing gaps, and participation over time. Visible to volunteer coordinators only — never shown to members as a ranking.`}
      />
      <SectionCard title="Volunteer program" description="Reminders go to signed-up volunteers whose shifts start in the next 48 hours (each volunteer is reminded once per shift).">
        <PtaVolunteerReports
          report={{
            schoolYear: report.schoolYear,
            totals: report.totals,
            byEvent: report.byEvent,
            byCommittee: report.byCommittee,
            topVolunteers: report.topVolunteers,
            unfilledOpportunities: report.unfilledOpportunities.map((row) => ({
              title: row.title,
              startAt: row.startAt?.toISOString() ?? null,
              openSpots: row.openSpots,
              totalCapacity: row.totalCapacity,
            })),
            participationByMonth: report.participationByMonth,
          }}
        />
      </SectionCard>
    </main>
  );
}
