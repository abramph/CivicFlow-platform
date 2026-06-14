import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ExpenditureForm } from "@/components/forms/ExpenditureForm";
import { getExpenditureFormOptions } from "@/lib/expenditure-options";

export default async function EditExpenditurePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId } = await requirePermission("expenditures:write");
  const { id } = await params;
  const [row, options] = await Promise.all([
    prisma.expenditure.findFirst({ where: { id, organizationId } }),
    getExpenditureFormOptions(organizationId),
  ]);

  if (!row) {
    return <main className="space-y-6"><PageHeader title="Expenditure not found" description="The requested expenditure is unavailable." actions={[{ href: "/expenditures", label: "Back to Expenditures" }]} /></main>;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Expenditure"
        description="Update expenditure details through the protected expenditure API."
        actions={[
          { href: `/expenditures/${row.id}`, label: "Back to Expenditure" },
          { href: "/expenditures", label: "Back to Expenditures" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Expenditure Form" description="Changes are audited and scoped to the current organization.">
        <ExpenditureForm
          mode="edit"
          expenditure={{
            id: row.id,
            date: row.date.toISOString().slice(0, 10),
            vendor: row.vendor,
            categoryId: row.categoryId,
            category: row.category,
            amount: row.amount.toString(),
            paymentMethodId: row.paymentMethodId,
            paymentMethod: row.paymentMethod,
            description: row.description,
            notes: row.notes,
            reference: row.reference,
            receiptUrl: row.receiptUrl,
            campaignId: row.campaignId,
            eventId: row.eventId,
          }}
          {...options}
        />
      </SectionCard>
    </main>
  );
}

