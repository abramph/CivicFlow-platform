import { getPtaPageGate } from "@/lib/labs/pta/guard";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { fiscalYearWindow } from "@/lib/budget";
import { getFinanceSummary } from "@/lib/reimbursements";
import { prisma } from "@/lib/prisma";
import { SectionCard } from "@/components/app/PageChrome";
import { PtaFinanceOverview } from "@/components/labs/pta/PtaFinanceOverview";

export default async function TreasurerOverviewPage() {
  const { organizationId, access } = await getPtaPageGate("budget:read");
  if (!access.available) return null;

  const profile = await getPtaProfile(organizationId);
  const fiscalYear = profile?.currentSchoolYear ?? String(new Date().getFullYear());
  const settings = await prisma.orgSettings.findUnique({ where: { organizationId }, select: { fiscalYearStart: true } });
  const window = fiscalYearWindow(fiscalYear, settings?.fiscalYearStart ?? 1);
  const summary = await getFinanceSummary(organizationId, window);

  return (
    <SectionCard title="Finance overview" description="Actuals come live from the contribution and expenditure ledgers — there is nothing to sync.">
      <PtaFinanceOverview summary={summary} />
    </SectionCard>
  );
}
