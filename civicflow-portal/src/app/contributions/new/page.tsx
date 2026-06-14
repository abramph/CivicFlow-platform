import { requirePermission } from "@/lib/auth-guards";
import { ensureDefaultPaymentMethods } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ContributionCreateForm } from "@/components/forms/ContributionCreateForm";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function NewContributionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId } = await requirePermission("contributions:write");
  const resolvedSearchParams = await searchParams;

  await ensureDefaultPaymentMethods(prisma, organizationId);

  const [members, campaigns, events, paymentMethods] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      take: 100,
      select: { id: true, name: true },
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { title: "asc" }],
      take: 100,
      select: { id: true, title: true },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { method: true, label: true, instructions: true },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Record Contribution"
        description="Create a contribution with member credit, optional campaign or event attribution, payment method, and receipt follow-up."
        actions={[
          { href: "/contributions", label: "Back to Contributions" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Members Available" value={members.length} />
        <StatCard label="Campaign Choices" value={campaigns.length} />
        <StatCard label="Event Choices" value={events.length} />
        <StatCard label="Create Path" value="Protected API" helper="Saved through POST /api/contributions." />
      </div>

      <SectionCard
        title="Contribution Entry"
        description="Use the same workflow whether the contribution originates from the member profile, a campaign, an event, or manual back-office entry."
      >
        <ContributionCreateForm
          members={members}
          campaigns={campaigns}
          events={events}
          paymentMethods={paymentMethods}
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
