import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaProfileForm } from "@/components/labs/pta/PtaProfileForm";

export default async function PtaSettingsPage() {
  const { organizationId, access } = await getPtaPageGate("pta:households:manage");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Unestra for PTA" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Unestra for PTA — Setup"
        description="Configure your PTA's basic information. This never touches your organization's paid plan or Stripe billing."
      />
      <SectionCard title="PTA profile" description="School/PTA name, designation, current school year, and membership model.">
        <PtaProfileForm initialProfile={profile} />
      </SectionCard>
    </main>
  );
}
