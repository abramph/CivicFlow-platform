import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { CampaignForm } from "@/components/forms/CampaignForm";
import { formatDateInputValue } from "@/lib/formatting";
import { prisma } from "@/lib/prisma";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("campaigns:write");
  const { id } = await params;

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId },
  });

  if (!campaign) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Campaign not found"
          description="The campaign you are trying to edit is unavailable in your organization."
          actions={[
            { href: "/campaigns", label: "Back to Campaigns" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Campaign"
        description="Update campaign details through the protected campaigns API."
        actions={[
          { href: `/campaigns/${campaign.id}`, label: "Back to Campaign" },
          { href: "/campaigns", label: "Back to Campaigns" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Campaign Form" description="Edit the goal, timeline, description, or status for this campaign.">
        <CampaignForm
          mode="edit"
          campaign={{
            id: campaign.id,
            name: campaign.name,
            description: campaign.description,
            goal: campaign.goal?.toString() ?? "",
            startDate: formatDateInputValue(campaign.startDate),
            endDate: formatDateInputValue(campaign.endDate),
            status: campaign.status,
            notes: campaign.notes,
          }}
        />
      </SectionCard>
    </main>
  );
}
