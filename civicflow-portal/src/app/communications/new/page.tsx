import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { CommunicationLogForm } from "@/components/forms/CommunicationLogForm";
import { CommunicationCampaignForm } from "@/components/forms/CommunicationCampaignForm";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function NewCommunicationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("communications:write");
  const resolvedSearchParams = await searchParams;

  const [members, campaigns, events, categories] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: 300,
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 150,
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true },
      take: 150,
    }),
    prisma.category.findMany({
      where: { organizationId, type: "MEMBERSHIP", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Communication"
        description="Send a mass communication campaign or record a single communication log entry."
        actions={[
          { href: "/communications/campaigns", label: "Campaigns" },
          { href: "/communications", label: "Back to Communications" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Mass Communication Campaign" description="Send announcements, meeting minutes, dues reminders, event notices, and general email communications to selected member groups.">
        <CommunicationCampaignForm categories={categories.map((category) => ({ id: category.id, label: category.name }))} />
      </SectionCard>
      <SectionCard title="Communication Entry" description="Organization context is taken from your authenticated session.">
        <CommunicationLogForm
          members={members.map((member) => ({ id: member.id, label: `${member.lastName}, ${member.firstName}` }))}
          campaigns={campaigns.map((campaign) => ({ id: campaign.id, label: campaign.name }))}
          events={events.map((event) => ({ id: event.id, label: event.title }))}
          defaults={{
            memberId: getValue(resolvedSearchParams.memberId),
            campaignId: getValue(resolvedSearchParams.campaignId),
            eventId: getValue(resolvedSearchParams.eventId),
          }}
        />
      </SectionCard>
    </main>
  );
}
