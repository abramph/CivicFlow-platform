import { requirePermission } from "@/lib/auth-guards";
import { getGivingSettings } from "@/lib/giving/module";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { GivingOperations } from "@/components/giving/GivingOperations";

/**
 * CORE-GIVE-F — Giving Operations: offline entry, corrections, and the
 * reconciliation report (docs/core-contributions-giving.md §6). The
 * reconciliation section renders only for holders of the separate
 * reconciliation capability (§46 separation of duties).
 */
export default async function GivingOperationsPage() {
  const { organizationId, can } = await requirePermission("contributions:offline:create");

  const settings = await getGivingSettings(organizationId);
  if (!settings.contributionsEnabled) {
    return (
      <main className="space-y-6">
        <PageHeader title="Giving Operations" description="Enable Contributions & Giving in Settings first." />
      </main>
    );
  }

  const [funds, members, recentOffline, households, recentProvider] = await Promise.all([
    prisma.fund.findMany({
      where: { organizationId, status: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.orgMember.findMany({
      where: { organizationId, membershipStatus: "active" },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true },
      take: 500,
    }),
    prisma.contribution.findMany({
      where: { organizationId, source: { in: ["MANUAL", "IMPORT"] }, fundId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        contributionNumber: true,
        amount: true,
        contributionDate: true,
        paymentMethod: true,
        contributorName: true,
        anonymityMode: true,
        voidedAt: true,
        fund: { select: { name: true } },
        member: { select: { firstName: true, lastName: true } },
      },
      take: 25,
    }),
    prisma.household.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      include: { members: { select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: "asc" } } },
      take: 500,
    }),
    prisma.contribution.findMany({
      where: { organizationId, paymentMethod: "STRIPE", providerPaymentIntentId: { not: null }, voidedAt: null },
      orderBy: { contributionDate: "desc" },
      select: {
        id: true,
        contributionNumber: true,
        amount: true,
        totalChargedAmount: true,
        refundedAmount: true,
        providerDisputeStatus: true,
        contributionDate: true,
        contributorName: true,
        anonymityMode: true,
        fund: { select: { name: true } },
        member: { select: { firstName: true, lastName: true } },
      },
      take: 25,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Giving Operations"
        description={`Record cash, checks, and other offline ${settings.terminology.toLowerCase()}, correct entries without destroying history, and reconcile against the payment provider.`}
      />
      <SectionCard title="Operations" description="Corrections void and replace — settled history is never edited in place.">
        <GivingOperations
          funds={funds}
          members={members.map((member) => ({ id: member.id, name: `${member.firstName} ${member.lastName}`.trim() }))}
          recent={recentOffline.map((row) => ({
            id: row.id,
            contributionNumber: row.contributionNumber,
            amount: Number(row.amount),
            date: row.contributionDate.toISOString(),
            method: row.paymentMethod ?? "—",
            attribution:
              row.anonymityMode === "PUBLICLY_ANONYMOUS"
                ? "(anonymous)"
                : row.member
                  ? `${row.member.firstName} ${row.member.lastName}`.trim()
                  : (row.contributorName ?? "—"),
            fundName: row.fund?.name ?? "—",
            voided: Boolean(row.voidedAt),
          }))}
          canReconcile={can("contributions:reconciliation:view")}
          households={households.map((household) => ({
            id: household.id,
            name: household.name,
            members: household.members.map((member) => ({
              id: member.id,
              name: `${member.firstName} ${member.lastName}`.trim(),
            })),
          }))}
          canManageHouseholds={can("members:write")}
          householdGivingEnabled={settings.householdGivingEnabled}
          canRefund={can("contributions:refund")}
          recentProvider={recentProvider.map((row) => ({
            id: row.id,
            contributionNumber: row.contributionNumber,
            amount: Number(row.amount),
            totalChargedAmount: row.totalChargedAmount !== null ? Number(row.totalChargedAmount) : null,
            refundedAmount: row.refundedAmount !== null ? Number(row.refundedAmount) : null,
            disputeStatus: row.providerDisputeStatus,
            date: row.contributionDate.toISOString(),
            attribution:
              row.anonymityMode === "PUBLICLY_ANONYMOUS"
                ? "(anonymous)"
                : row.member
                  ? `${row.member.firstName} ${row.member.lastName}`.trim()
                  : (row.contributorName ?? "—"),
            fundName: row.fund?.name ?? "—",
          }))}
        />
      </SectionCard>
    </main>
  );
}
