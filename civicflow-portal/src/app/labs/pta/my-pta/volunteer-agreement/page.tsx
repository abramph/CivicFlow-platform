import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaVolunteerAgreementAcceptance } from "@/components/labs/pta/PtaVolunteerAgreementAcceptance";
import { resolveHouseholdAgreementStatus } from "@/lib/labs/pta/volunteer-hours/agreements";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod, getVolunteerRequirementPeriod } from "@/lib/labs/pta/volunteer-hours/periods";

/**
 * feature/pta-family-agreement-buyout, FA-6. A dedicated route rather than
 * embedded inline in the existing my-pta dashboard — deliberately: this
 * keeps the (large, already-shipped) dashboard page untouched, so this
 * feature can never regress it, at the cost of one extra click for a
 * family to reach the agreement. Linked from the dashboard's own volunteer
 * summary card in a follow-up, not this program (see docs section on
 * remaining limitations).
 */
export default async function PtaVolunteerAgreementPage() {
  const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
  const current = await getCurrentActivePeriod(organizationId);

  if (!current) {
    return (
      <main className="space-y-6">
        <PageHeader title="Volunteer commitment agreement" description="No active volunteer requirement period." />
      </main>
    );
  }

  const [status, period] = await Promise.all([
    resolveHouseholdAgreementStatus(organizationId, current.id, adult.householdId),
    getVolunteerRequirementPeriod(organizationId, current.id),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader title="Volunteer commitment agreement" description={period.name} />
      <SectionCard title="Agreement" description="Review and accept your PTA's volunteer commitment agreement for this period.">
        <PtaVolunteerAgreementAcceptance
          organizationTimezone={period.timezone}
          status={{
            required: status.required,
            assignedVersion: status.assignedVersion
              ? { id: status.assignedVersion.id, title: status.assignedVersion.title, versionNumber: status.assignedVersion.versionNumber, content: status.assignedVersion.content }
              : null,
            acceptance: status.acceptance ? { acceptedAt: status.acceptance.acceptedAt.toISOString(), typedName: status.acceptance.typedName } : null,
            contractLinkedBuyoutEnabled: status.contractLinkedBuyoutEnabled,
            contractLinkedEligibleUntil: status.contractLinkedEligibleUntil ? status.contractLinkedEligibleUntil.toISOString() : null,
            contractLinkedEligibleNow: status.contractLinkedEligibleNow,
            periodId: current.id,
          }}
        />
      </SectionCard>
    </main>
  );
}
