import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getSchoolYearContext } from "@/lib/labs/pta/school-years";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaProfileForm } from "@/components/labs/pta/PtaProfileForm";
import { PtaSchoolYearsManager } from "@/components/labs/pta/PtaSchoolYearsManager";

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
    </main>
  );
}
