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
  const statementCount = settings.contributionsEnabled
    ? await prisma.contributionStatement.count({ where: { organizationId } })
    : 0;
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
        title="Activation checklist"
        description="A guided path from off to collecting — each step is the real page, nothing here activates payment collection by itself."
      >
        <ol className="space-y-2">
          {([
            { label: "Enable the Contributions & Giving module", done: settings.contributionsEnabled, href: null },
            { label: "Review who holds financial permissions", done: null, href: "/settings/users" },
            { label: "Create your first fund (most organizations start with a General Fund)", done: funds.length > 0, href: null },
            { label: "Configure giving options (programs, suggested amounts, recurring)", done: programs.length > 0, href: null },
            { label: "Choose your terminology (Giving / Contributions / Support)", done: settings.contributionsEnabled, href: null },
            { label: "Prepare year-end statements when the time comes", done: statementCount > 0, href: "/giving/operations" },
            { label: "Public giving page", done: null, href: null, comingSoon: true },
            { label: "Test the member experience on your Giving page", done: null, href: "/m/giving" },
          ] satisfies { label: string; done: boolean | null; href: string | null; comingSoon?: boolean }[]).map((step, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done === true
                    ? "bg-emerald-600 text-white"
                    : "border border-slate-300 bg-white text-slate-500"
                }`}
              >
                {step.done === true ? "✓" : index + 1}
              </span>
              <span className={step.comingSoon ? "text-slate-400" : "text-slate-800"}>
                {step.href && !step.comingSoon ? (
                  <a href={step.href} className="hover:underline">
                    {step.label}
                  </a>
                ) : (
                  step.label
                )}
                {step.comingSoon ? " — coming in a later update" : null}
              </span>
            </li>
          ))}
        </ol>
      </SectionCard>
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
