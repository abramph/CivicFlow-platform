import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { CampaignForm } from "@/components/forms/CampaignForm";

export default async function NewCampaignPage() {
  await requirePermission("campaigns:write");

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Campaign"
        description="Create a campaign with a goal, timeline, and clear status for contribution tracking."
        actions={[
          { href: "/campaigns", label: "Back to Campaigns" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Campaign Setup" description="Campaign creation is protected by campaigns:write and scoped to the authenticated organization.">
        <CampaignForm mode="create" />
      </SectionCard>
    </main>
  );
}
