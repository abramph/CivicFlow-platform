import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { listReimbursements } from "@/lib/reimbursements";
import { prisma } from "@/lib/prisma";
import { SectionCard } from "@/components/app/PageChrome";
import { PtaReimbursementManager } from "@/components/labs/pta/PtaReimbursementManager";

export default async function TreasurerReimbursementsPage() {
  const { organizationId, session, access, can } = await getPtaPageGate("budget:read");
  if (!access.available) return null;

  const [reimbursements, categories, committees, events, paymentMethods] = await Promise.all([
    listReimbursements(organizationId, { userId: session.userId, canManage: can("reimbursements:manage") }),
    prisma.category.findMany({
      where: { organizationId, type: "EXPENDITURE", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.ptaCommittee.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.event.findMany({
      where: { organizationId },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, method: true, label: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  return (
    <SectionCard title="Reimbursements" description="Submit, review, approve, and pay reimbursement requests.">
      <PtaReimbursementManager
        reimbursements={reimbursements.map((row) => ({
          id: row.id,
          payeeName: row.payeeName,
          description: row.description,
          amount: Number(row.amount),
          status: row.status,
          submittedBy: row.submittedBy?.displayName || row.submittedBy?.email || "Unknown",
          submittedByIsViewer: row.submittedByUserId === session.userId,
          categoryName: row.category?.name ?? null,
          eventTitle: row.event?.title ?? null,
          committeeName: row.committee?.name ?? null,
          createdAt: row.createdAt.toISOString(),
          rejectionReason: row.rejectionReason,
        }))}
        categories={categories}
        committees={committees}
        events={events}
        paymentMethods={paymentMethods}
        viewer={{
          canManageBudget: can("budget:manage"),
          canSubmit: can("reimbursements:submit"),
          canManageReimbursements: can("reimbursements:manage"),
        }}
      />
    </SectionCard>
  );
}
