import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { fiscalYearWindow, getBudgetWithActuals } from "@/lib/budget";
import { getFinanceSummary, listReimbursements } from "@/lib/reimbursements";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { PtaLabsBadge } from "@/components/labs/pta/PtaLabsBadge";
import { PtaFinanceDashboard } from "@/components/labs/pta/PtaFinanceDashboard";

/**
 * PTA Vertical 2.0, PR PTA-H — the treasurer dashboard (docs/pta-vertical-2.md
 * PTA-H): income vs spend, budget vs actual, and the reimbursement queue.
 * Core data (BudgetLine/ReimbursementRequest) with PTA presentation; the
 * fiscal year is the PTA's current school year.
 */
export default async function PtaFinancePage() {
  const { organizationId, session, access, can } = await getPtaPageGate("budget:read");

  if (!access.available) {
    return (
      <main className="space-y-6">
        <PageHeader title="Treasurer" description="Not available for this organization." />
      </main>
    );
  }

  const profile = await getPtaProfile(organizationId);
  const fiscalYear = profile?.currentSchoolYear ?? String(new Date().getFullYear());
  const settings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { fiscalYearStart: true } });
  const window = fiscalYearWindow(fiscalYear, settings?.fiscalYearStart ?? 1);

  const [budget, summary, reimbursements, categories, committees, events, paymentMethods] = await Promise.all([
    getBudgetWithActuals(organizationId, fiscalYear),
    getFinanceSummary(organizationId, window),
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
    <main className="space-y-6">
      <PtaLabsBadge />
      <PageHeader
        title="Treasurer"
        description={`Your PTA's operating finances for ${fiscalYear}: budget vs. actual, income and spending, and reimbursements. Unestra never stores bank credentials — marking a reimbursement paid records a payment made outside Unestra.`}
      />
      <SectionCard title="Finance overview" description="Actuals come live from the contribution and expenditure ledgers — there is nothing to sync.">
        <PtaFinanceDashboard
          fiscalYear={fiscalYear}
          summary={summary}
          budget={{
            totals: budget.totals,
            lines: budget.lines.map((line) => ({
              id: line.id,
              name: line.name,
              categoryName: line.categoryName,
              plannedAmount: line.plannedAmount,
              actualAmount: line.actualAmount,
              variance: line.variance,
            })),
          }}
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
    </main>
  );
}
