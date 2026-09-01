import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ExpenditureForm } from "@/components/forms/ExpenditureForm";
import { getExpenditureFormOptions } from "@/lib/expenditure-options";
import { canEditFinancialRecord, getFinancialEditPolicy } from "@/lib/financial-edit-policy";

const BASE_PATH = "/labs/pta/finance/expenditures";

export default async function TreasurerEditExpenditurePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, access, role } = await getPtaPageGate("expenditures:write");
  if (!access.available) return null;
  const { id } = await params;
  const [row, options, policy] = await Promise.all([
    prisma.expenditure.findFirst({ where: { id, organizationId } }),
    getExpenditureFormOptions(organizationId, "PTA"),
    getFinancialEditPolicy(organizationId),
  ]);

  if (!row) {
    return <PageHeader title="Expenditure not found" description="The requested expenditure is unavailable." actions={[{ href: BASE_PATH, label: "Back to Expenditures" }]} />;
  }

  const editCheck = canEditFinancialRecord({ record: row, role, policy });
  const editability = { allowed: editCheck.allowed || editCheck.requiresReason, reason: editCheck.reason, requiresReason: editCheck.requiresReason };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit Expenditure"
        description="Update expenditure details through the protected expenditure API."
        actions={[
          { href: `${BASE_PATH}/${row.id}`, label: "Back to Expenditure" },
          { href: BASE_PATH, label: "Back to Expenditures" },
        ]}
      />
      <SectionCard title="Expenditure Form" description="Changes are audited and scoped to the current organization.">
        <ExpenditureForm
          mode="edit"
          basePath={BASE_PATH}
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
            committeeId: row.committeeId,
          }}
          editability={editability}
          {...options}
        />
      </SectionCard>
    </div>
  );
}
