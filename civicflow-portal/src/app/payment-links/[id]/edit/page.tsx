import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentLinkForm } from "@/components/forms/PaymentLinkForm";
import { prisma } from "@/lib/prisma";

export default async function EditPaymentLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("contributions:write");
  const { id } = await params;

  const [link, campaigns, events, paymentMethods] = await Promise.all([
    prisma.paymentLink.findFirst({ where: { id, organizationId }, include: { methods: true } }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, method: true, label: true },
    }),
  ]);

  if (!link) notFound();

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Payment Link"
        description={`Editing: ${link.title}`}
        actions={[{ href: `/payment-links/${link.id}`, label: "Back to Link" }]}
      />
      <SectionCard title="Link Details">
        <PaymentLinkForm
          mode="edit"
          campaigns={campaigns}
          events={events}
          paymentMethods={paymentMethods}
          link={{
            id: link.id,
            title: link.title,
            description: link.description,
            linkType: link.linkType,
            amount: link.amount?.toString() ?? null,
            minAmount: link.minAmount?.toString() ?? null,
            campaignId: link.campaignId,
            eventId: link.eventId,
            status: link.status,
            expiresAt: link.expiresAt?.toISOString() ?? null,
            paymentMethodConfigIds: link.methods.map((m) => m.paymentMethodConfigId),
          }}
        />
      </SectionCard>
    </main>
  );
}
