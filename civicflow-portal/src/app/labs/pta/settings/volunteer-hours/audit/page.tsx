import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaVolunteerAuditHistory } from "@/components/labs/pta/PtaVolunteerAuditHistory";

export default async function PtaVolunteerHoursAuditPage() {
  const { organizationId, access } = await getPtaPageGate("pta:volunteer-audit:view");

  if (!access.available || !(await checkVolunteerHoursAvailable(organizationId, "requirements"))) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer Hours Audit History" description="Not available for this organization." />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Volunteer Hours Audit History"
        description="Every action this feature has recorded, across every requirement period — period/pricing setup, elections, purchases, assessments, corrections, report exports, and notifications."
        actions={[{ href: "/labs/pta/settings", label: "Back to settings" }]}
      />
      <SectionCard title="Activity" description="Most recent first.">
        <PtaVolunteerAuditHistory />
      </SectionCard>
    </main>
  );
}
