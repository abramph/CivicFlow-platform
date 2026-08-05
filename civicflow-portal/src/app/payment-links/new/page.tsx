import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentLinkForm } from "@/components/forms/PaymentLinkForm";
import { prisma } from "@/lib/prisma";

export default async function NewPaymentLinkPage() {
  const { organizationId } = await requirePermission("contributions:write");

  const [campaigns, events, paymentMethods] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.event.findMany({
      where: { organizationId, status: "upcoming" },
      orderBy: { startAt: "asc" },
      select: { id: true, title: true },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, method: true, label: true },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Payment Link"
        description="Create a shareable link that lets people pay your organization using one or more methods you offer."
        actions={[{ href: "/payment-links", label: "Back to Payment Links" }]}
      />
      <SectionCard title="Link Setup" description="Fixed-amount links go straight to Stripe. Flexible links let the payer enter an amount.">
        <PaymentLinkForm mode="create" campaigns={campaigns} events={events} paymentMethods={paymentMethods} />
      </SectionCard>
    </main>
  );
}
