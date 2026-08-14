import { requirePermission } from "@/lib/auth-guards";
import { getGivingSettings } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { GivingSetupManager } from "@/components/giving/GivingSetupManager";

/**
 * CORE-GIVE-A — Contributions & Giving setup (docs/core-contributions-giving.md).
 * The module master switch, terminology, funds, and programs. Member-facing
 * giving flows arrive in CORE-GIVE-B; until then this page is the module's
 * complete admin workflow (§114: no empty modules — setup IS the workflow).
 */
export default async function GivingSetupPage() {
  const { organizationId, can } = await requirePermission("contributions:summary:view");

  const settings = await getGivingSettings(organizationId);
  const [funds, programs] = settings.contributionsEnabled
    ? await Promise.all([
        prisma.fund.findMany({
          where: { organizationId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { _count: { select: { programs: true, contributions: true } } },
        }),
        prisma.contributionProgram.findMany({
          where: { organizationId },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { fund: { select: { id: true, name: true } } },
        }),
      ])
    : [[], []];

  return (
    <main className="space-y-6">
      <PageHeader
        title={`${settings.terminology} & Giving`}
        description="Funds are where money is designated; programs are the giving experiences you offer. Required obligations exist only for dues programs — voluntary giving never creates debt, arrears, or delinquency."
      />
      <SectionCard
        title="Module setup"
        description="Giving is off by default. Enabling it configures the module only — no payment collection starts until giving flows are published."
      >
        <GivingSetupManager
          settings={settings}
          funds={funds.map((fund) => ({
            id: fund.id,
            name: fund.name,
            description: fund.description,
            status: fund.status,
            isPublic: fund.isPublic,
            allowPledges: fund.allowPledges,
            suggestedAmounts: fund.suggestedAmounts.map((amount) => Number(amount)),
            programCount: fund._count.programs,
            contributionCount: fund._count.contributions,
          }))}
          programs={programs.map((program) => ({
            id: program.id,
            name: program.name,
            type: program.type,
            obligationNature: program.obligationNature,
            status: program.status,
            fundName: program.fund.name,
            allowedFrequencies: program.allowedFrequencies,
          }))}
          viewer={{
            canManageFunds: can("contributions:funds:manage"),
            canManagePrograms: can("contributions:programs:manage"),
          }}
        />
      </SectionCard>
    </main>
  );
}
