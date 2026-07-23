import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { Breadcrumbs, EmptyState } from "@/components/admin/OperationsUI";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { HouseholdForm } from "@/components/labs/pta/HouseholdForm";

export default async function NewPtaHouseholdPage() {
  const { organizationId, access } = await getPtaPageGate("pta:households:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Add Household" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);

  return (
    <main className="space-y-6">
      <PtaLabsBadge />
      <Breadcrumbs items={[{ href: "/labs/pta/households", label: "Household Directory" }, { label: "Add household" }]} />
      <PageHeader title="Add a household" description="Creates the household and its billing identity — you can add adults, students, and dues afterward." />
      {profile ? (
        <SectionCard title="New household">
          <HouseholdForm defaultSchoolYear={profile.currentSchoolYear} />
        </SectionCard>
      ) : (
        <EmptyState title="Set up your PTA profile first" description="Configure your school/PTA name and current school year at Settings before adding households." />
      )}
    </main>
  );
}
