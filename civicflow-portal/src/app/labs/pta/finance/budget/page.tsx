import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { getBudgetWithActuals } from "@/lib/budget";
import { prisma } from "@/lib/prisma";
import { SectionCard } from "@/components/app/PageChrome";
import { PtaBudgetManager } from "@/components/labs/pta/PtaBudgetManager";

export default async function TreasurerBudgetPage() {
  const { organizationId, access, can } = await getPtaPageGate("budget:read");
  if (!access.available) return null;

  const profile = await getPtaProfile(organizationId);
  const fiscalYear = profile?.currentSchoolYear ?? String(new Date().getFullYear());

  const [budget, categories] = await Promise.all([
    getBudgetWithActuals(organizationId, fiscalYear),
    prisma.category.findMany({
      where: { organizationId, type: "EXPENDITURE", isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <SectionCard title="Budget" description="Plan spending by line, linked to expenditure categories.">
      <PtaBudgetManager
        fiscalYear={fiscalYear}
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
        categories={categories}
        canManageBudget={can("budget:manage")}
      />
    </SectionCard>
  );
}
