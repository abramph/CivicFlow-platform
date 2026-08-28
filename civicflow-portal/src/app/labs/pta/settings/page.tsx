import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
import { listVolunteerRequirementPeriods } from "@/lib/labs/pta/volunteer-hours/periods";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaProfileForm } from "@/components/labs/pta/PtaProfileForm";
import { PtaSchoolYearsManager } from "@/components/labs/pta/PtaSchoolYearsManager";
import { PtaVolunteerHoursSettings } from "@/components/labs/pta/PtaVolunteerHoursSettings";
import { PtaVolunteerPeriodsManager } from "@/components/labs/pta/PtaVolunteerPeriodsManager";

export default async function PtaSettingsPage() {
  const { organizationId, access, can } = await getPtaPageGate("pta:households:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Unestra for PTA" description="Not available for this organization." />
      </main>
    );
  }

  const [profile, schoolYears] = await Promise.all([getPtaProfile(organizationId), getSchoolYearContext(organizationId)]);

  // The toggle panel (can the org turn this feature ON at all) is gated on
  // holding a manage permission, NOT on the feature already being enabled —
  // otherwise nobody could ever turn it on in the first place. The periods
  // manager below it is the opposite: it only renders once the
  // requirements flag (+ platform kill-switch) is actually on.
  const canManageAnyVolunteerHoursCapability =
    can("pta:volunteer-requirements:manage") ||
    can("pta:volunteer-buyout-pricing:manage") ||
    can("pta:volunteer-assessments:preview-post") ||
    can("pta:volunteer-reports:export");
  const canViewVolunteerRequirements = can("pta:volunteer-requirements:view");
  const volunteerHoursAvailable =
    canViewVolunteerRequirements && (await checkVolunteerHoursAvailable(organizationId, "requirements"));
  const volunteerPeriods = volunteerHoursAvailable ? await listVolunteerRequirementPeriods(organizationId) : [];

  return (
    <main className="space-y-6">
      <PageHeader
        title="Unestra for PTA — Setup"
        description="Configure your PTA's basic information. This never touches your organization's paid plan or Stripe billing."
      />
      <SectionCard title="PTA profile" description="School/PTA name, designation, current school year, and membership model.">
        <PtaProfileForm
          initialProfile={profile}
          canManageConcerns={can("pta:concerns:manage")}
          canManageElections={can("pta:elections:manage")}
        />
      </SectionCard>
      {can("pta:school-years:manage") ? (
        <SectionCard
          title="School years"
          description="Your PTA's operating years. Records like households, classrooms, and volunteer programs are organized by school year — set the current one here and prepare the next year ahead of time."
        >
          <PtaSchoolYearsManager
            years={schoolYears.years.map((year) => ({ id: year.id, label: year.label, isCurrent: year.isCurrent }))}
            suggestedNextLabel={schoolYears.suggestedNextLabel}
          />
        </SectionCard>
      ) : null}
      {canManageAnyVolunteerHoursCapability ? (
        <SectionCard
          title="Volunteer Requirements & Buyout"
          description="Optional. Require a set number of volunteer hours per family, let families pay for hours they don't complete, and charge for hours left unmet at period end. Everything below is off until you turn it on."
        >
          <PtaVolunteerHoursSettings
            initialFlags={profile}
            canManageRequirements={can("pta:volunteer-requirements:manage")}
            canManageBuyoutPricing={can("pta:volunteer-buyout-pricing:manage")}
            canManageAssessments={can("pta:volunteer-assessments:preview-post")}
            canManageReportsExport={can("pta:volunteer-reports:export")}
          />
        </SectionCard>
      ) : null}
      {volunteerHoursAvailable && can("pta:volunteer-audit:view") ? (
        <p className="text-sm">
          <a href="/labs/pta/settings/volunteer-hours/audit" className="font-semibold text-emerald-700 hover:underline">
            View volunteer-hours audit history →
          </a>
        </p>
      ) : null}
      {volunteerHoursAvailable ? (
        <SectionCard
          title="Volunteer requirement periods"
          description="Set up the school year, term, or contract period families are held to, including hours required, deadlines, and the buyout/assessment windows."
        >
          <PtaVolunteerPeriodsManager
            periods={volunteerPeriods.map((p) => ({
              ...p,
              startsOn: p.startsOn.toISOString(),
              endsOn: p.endsOn.toISOString(),
              volunteerDeadline: p.volunteerDeadline?.toISOString() ?? null,
              buyoutWindowStart: p.buyoutWindowStart?.toISOString() ?? null,
              buyoutWindowEnd: p.buyoutWindowEnd?.toISOString() ?? null,
              assessmentDate: p.assessmentDate?.toISOString() ?? null,
              assessmentPaymentDueDate: p.assessmentPaymentDueDate?.toISOString() ?? null,
            }))}
          />
        </SectionCard>
      ) : null}
    </main>
  );
}
