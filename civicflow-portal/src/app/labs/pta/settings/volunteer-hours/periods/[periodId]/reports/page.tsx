import { notFound } from "next/navigation";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { getVolunteerRequirementPeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaVolunteerReportsCenter } from "@/components/labs/pta/PtaVolunteerReportsCenter";

export default async function PtaVolunteerReportsPage({ params }: { params: Promise<{ periodId: string }> }) {
  const { organizationId, access, can } = await getPtaPageGate("pta:volunteer-reports:view");
  const { periodId } = await params;

  if (!access.available || !(await checkVolunteerHoursAvailable(organizationId, "reports"))) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Hours Reporting Center" description="Not available for this organization." />
      </main>
    );
  }

  const period = await getVolunteerRequirementPeriod(organizationId, periodId).catch(() => null);
  if (!period) notFound();

  return (
    <main className="space-y-6">
      <PageHeader
        title={`Reports — ${period.name}`}
        description="On-screen reports and formatted .xlsx exports. Every report shown here calls the same server-side calculation as the family dashboard and the assessment batch — totals can never diverge between what you see and what you download."
        actions={[{ href: `/labs/pta/settings/volunteer-hours/periods/${periodId}`, label: "Back to period" }]}
      />
      <SectionCard
        title="Volunteer Hours Reports"
        description="Family Summary, Detailed Activity, Event Hours, Compliance, Purchased-Hours & Financial, Individual Volunteer, and Volunteer Category reports."
      >
        <PtaVolunteerReportsCenter
          periodId={periodId}
          canExport={can("pta:volunteer-reports:export")}
          canViewFinancial={can("pta:volunteer-financial-reports:view")}
        />
      </SectionCard>
    </main>
  );
}
