import { notFound } from "next/navigation";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listPeriodAssignments } from "@/lib/labs/pta/volunteer-hours/assignments";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { getVolunteerRequirementPeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaVolunteerAssignmentsManager } from "@/components/labs/pta/PtaVolunteerAssignmentsManager";

export default async function PtaVolunteerPeriodAssignmentsPage({ params }: { params: Promise<{ periodId: string }> }) {
  const { organizationId, access, can } = await getPtaPageGate("pta:volunteer-requirements:view");
  const { periodId } = await params;

  if (!access.available || !(await checkVolunteerHoursAvailable(organizationId, "requirements"))) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer requirement period" description="Not available for this organization." />
      </main>
    );
  }

  const period = await getVolunteerRequirementPeriod(organizationId, periodId).catch(() => null);
  if (!period) notFound();

  const assignments = await listPeriodAssignments(organizationId, periodId);

  return (
    <main className="space-y-6">
      <PageHeader
        title={period.name}
        description={`Assignment rules for this requirement period — how the ${(period.requiredMinutesDefault / 60).toString()}-hour default is adjusted per family.`}
        actions={[{ href: "/labs/pta/settings", label: "Back to settings" }]}
      />
      <SectionCard title="Assignment rules & preview" description="Custom hours, exemptions, reductions, and waivers, plus a full per-family preview.">
        <PtaVolunteerAssignmentsManager
          periodId={periodId}
          assignments={assignments.map((a) => ({ ...a, exemptUntil: a.exemptUntil?.toISOString() ?? null }))}
          canManageScopeRules={can("pta:volunteer-requirements:manage")}
          canAdjustFamily={can("pta:volunteer-requirements:adjust-family")}
        />
      </SectionCard>
    </main>
  );
}
