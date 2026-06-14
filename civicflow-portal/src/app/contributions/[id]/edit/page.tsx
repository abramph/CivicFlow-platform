import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { defaultPaymentMethods } from "@/lib/payment-methods";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ContributionEditForm } from "@/components/forms/ContributionEditForm";

export default async function ContributionEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("contributions:write");
  const { id } = await params;

  const [contribution, paymentMethodConfigs] = await Promise.all([
    prisma.contribution.findFirst({
      where: { id, organizationId },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { method: true, label: true },
    }),
  ]);

  if (!contribution) notFound();
  if (contribution.voidedAt) notFound();

  const isLocked = !!contribution.lockedAt;

  const contributionDate = contribution.contributionDate
    ? new Date(contribution.contributionDate).toISOString().slice(0, 10)
    : "";

  const paymentMethods =
    paymentMethodConfigs.length > 0
      ? paymentMethodConfigs
      : defaultPaymentMethods.map((m) => ({ method: m.method, label: m.label }));

  const defaults = {
    amount: Number(contribution.amount).toFixed(2),
    contributionDate,
    paymentMethod: contribution.paymentMethod ?? "",
    notes: contribution.notes ?? "",
    receiptRequested: contribution.receiptRequested ?? false,
  };

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Contribution"
        description={`Contribution #${contribution.id.slice(-8).toUpperCase()} · Revision ${contribution.revisionNumber}`}
        actions={[
          { href: `/contributions/${id}`, label: "Cancel" },
          { href: "/contributions", label: "All Contributions" },
        ]}
      />

      {isLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold">This contribution is locked.</p>
          <p className="mt-1">Amount and date cannot be changed. Notes and payment method are still editable.</p>
        </div>
      ) : null}

      <SectionCard title="Edit details" description="Changes are recorded with a revision number and audit entry.">
        <ContributionEditForm
          contributionId={id}
          defaults={defaults}
          paymentMethods={paymentMethods}
          isLocked={isLocked}
        />
      </SectionCard>
    </main>
  );
}
