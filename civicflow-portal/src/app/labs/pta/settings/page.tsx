import { isPtaVolunteerHoursOrgAllowed, isPtaVolunteerHoursPlatformEnabled } from "@/lib/env";
import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { canViewVolunteerHoursSettingsPanel, checkVolunteerHoursAvailable } from "@/lib/labs/pta/volunteer-hours/guard";
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
  // holding a manage permission AND the platform kill-switch AND the pilot
  // allowlist — while the platform is dark, OR this org simply isn't on the
  // allowlist, no org admin (including one acting as SUPER_ADMIN, whose
  // org-scoped permissions equal ORG_OWNER's) can see or flip these flags,
  // so a non-pilot org can't pre-stage itself to activate the instant the
  // platform switch flips on or the allowlist later grows. Once both the
  // platform switch and the allowlist are on for this org, this reverts to
  // permission-only gating — otherwise nobody could ever turn the feature on
  // in the first place. The periods manager below it is gated purely on the
  // requirements flag (+ platform switch + allowlist, all inside
  // requireVolunteerHoursFlag) actually being on, unchanged.
  const canManageAnyVolunteerHoursCapability = canViewVolunteerHoursSettingsPanel(
    isPtaVolunteerHoursPlatformEnabled(),
    isPtaVolunteerHoursOrgAllowed(organizationId),
    {
      canManageRequirements: can("pta:volunteer-requirements:manage"),
      canManageBuyoutPricing: can("pta:volunteer-buyout-pricing:manage"),
      canManageAssessments: can("pta:volunteer-assessments:preview-post"),
      canManageReportsExport: can("pta:volunteer-reports:export"),
    }
  );
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
