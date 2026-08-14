import { requirePermission } from "@/lib/auth-guards";
import { getGivingSettings } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { GivingReports } from "@/components/giving/GivingReports";

/**
 * CORE-GIVE-K (§52) — giving reports. Aggregates for summary-view holders;
 * individual-naming reports and CSV export gate further in the API.
 */
export default async function GivingReportsPage() {
  const { organizationId, can } = await requirePermission("contributions:summary:view");

  const settings = await getGivingSettings(organizationId);
  if (!settings.contributionsEnabled) {
    return (
      <main className="space-y-6">
        <PageHeader title="Giving Reports" description="Enable Contributions & Giving in Settings first." />
      </main>
    );
  }
  const funds = await prisma.fund.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${settings.terminology} Reports`}
        description="Net amounts subtract refunds. Reports naming individual contributors and CSV exports carry their own permissions; every export is audited."
      />
      <SectionCard title="Run a report" description="Pick a report, a date range, and optionally a fund.">
        <GivingReports
          funds={funds}
          viewer={{ canSeeIndividual: can("contributions:individual:view"), canExport: can("contributions:export") }}
        />
      </SectionCard>
    </main>
  );
}
