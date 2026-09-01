import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { ExpenditureForm } from "@/components/forms/ExpenditureForm";
import { getExpenditureFormOptions } from "@/lib/expenditure-options";
import { canEditFinancialRecord, getFinancialEditPolicy } from "@/lib/financial-edit-policy";

export default async function EditExpenditurePage({ params }: { params: Promise<{ id: string }> }) {
  const { organizationId, session, role } = await requirePermission("expenditures:write");
  const { id } = await params;
  const [row, options, policy] = await Promise.all([
    prisma.expenditure.findFirst({ where: { id, organizationId } }),
    getExpenditureFormOptions(organizationId, session.primaryVertical ?? "COMMUNITY"),
    getFinancialEditPolicy(organizationId),
  ]);

  if (!row) {
    return <main className="space-y-6"><PageHeader title="Expenditure not found" description="The requested expenditure is unavailable." actions={[{ href: "/expenditures", label: "Back to Expenditures" }]} /></main>;
  }

  const editCheck = canEditFinancialRecord({ record: row, role, policy });
  // requiresReason means the record is only editable *alongside* a reason
  // the user hasn't typed yet -- that's a usable form (reason field shown
  // and required), not a disabled one. Only a hard block (voided, locked
  // without finance/admin permission, or corrections disabled org-wide)
  // should disable the form outright.
  const editability = { allowed: editCheck.allowed || editCheck.requiresReason, reason: editCheck.reason, requiresReason: editCheck.requiresReason };

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
          basePath="/expenditures"
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
    </main>
  );
}
