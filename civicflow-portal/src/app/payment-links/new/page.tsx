import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PaymentLinkForm } from "@/components/forms/PaymentLinkForm";
import { prisma } from "@/lib/prisma";

export default async function NewPaymentLinkPage() {
  const { organizationId } = await requirePermission("contributions:write");

  const [campaigns, events] = await Promise.all([
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
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="New Payment Link"
        description="Create a shareable link that lets anyone pay your organization via Stripe without logging in."
        actions={[{ href: "/payment-links", label: "Back to Payment Links" }]}
      />
      <SectionCard title="Link Setup" description="Fixed-amount links go straight to Stripe. Flexible links let the payer enter an amount.">
        <PaymentLinkForm mode="create" campaigns={campaigns} events={events} />
      </SectionCard>
    </main>
  );
}
