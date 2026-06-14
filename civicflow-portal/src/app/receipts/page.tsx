import { requirePermission } from "@/lib/auth-guards";
import { paymentMethodLabels as defaultPaymentMethodLabels } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { ReceiptsManager } from "@/components/forms/ReceiptsManager";

export default async function ReceiptsPage() {
  const { organizationId } = await requirePermission("receipts:read");
  const [rows, contributions, paymentMethods] = await Promise.all([
    prisma.contributionReceipt.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { contribution: true, member: true },
      take: 100,
    }),
    prisma.contribution.findMany({
      where: { organizationId },
      orderBy: [{ contributionDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      take: 120,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId },
      select: { method: true, label: true },
    }),
  ]);
  const methodLabels = Object.fromEntries(defaultPaymentMethodLabels);
  for (const method of paymentMethods) {
    methodLabels[method.method] = method.label;
  }
  const receiptAttachments = rows.length
    ? await prisma.attachment.findMany({
        where: {
          organizationId,
          entityType: "RECEIPT",
          entityId: { in: rows.map((row) => row.id) },
          deletedAt: null,
        },
        orderBy: { uploadedAt: "desc" },
      })
    : [];
  const attachmentByReceiptId = new Map(receiptAttachments.map((attachment) => [attachment.entityId, attachment]));

  return (
    <main className="space-y-6">
      <PageHeader
        title="Receipts"
        description="Issue receipts against recorded contributions and monitor delivery status."
        actions={[
          { href: "/contributions", label: "Contributions" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Receipts" value={rows.length} />
        <StatCard label="Delivered" value={rows.filter((row) => row.deliveryStatus === "SENT").length} />
        <StatCard label="Ready Contributions" value={contributions.length} />
      </div>

      <SectionCard title="Issue Contribution Receipt" description="Use the stored contribution and member context to issue a receipt and trigger the receipt artifact workflow.">
        <ReceiptsManager
          contributions={contributions.map((contribution) => ({
            ...contribution,
            contributionDate: contribution.contributionDate.toISOString(),
            amount: contribution.amount.toString(),
            paymentMethodLabel: contribution.paymentMethod
              ? methodLabels[contribution.paymentMethod] ?? contribution.paymentMethod
              : null,
          }))}
          receipts={rows.map((receipt) => ({
            id: receipt.id,
            receiptNumber: receipt.receiptNumber,
            deliveryStatus: receipt.deliveryStatus,
            deliveredAt: receipt.deliveredAt?.toISOString() ?? null,
            createdAt: receipt.createdAt.toISOString(),
            memberName: receipt.member ? `${receipt.member.firstName} ${receipt.member.lastName}` : null,
            contributionAmount: receipt.contribution.amount.toString(),
            attachmentId: attachmentByReceiptId.get(receipt.id)?.id ?? null,
          }))}
        />
      </SectionCard>
    </main>
  );
}
