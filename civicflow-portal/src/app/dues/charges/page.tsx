import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { DuesChargesManager } from "@/components/forms/DuesChargesManager";

function getValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function DuesChargesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, can } = await requirePermission("dues:read");
  const canWrite = can("dues:write");
  const resolvedSearchParams = await searchParams;
  const memberId = getValue(resolvedSearchParams.memberId);

  const [members, accounts, charges] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      take: 200,
    }),
    prisma.duesAccount.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ name: "asc" }],
      include: {
        category: true,
      },
      take: 150,
    }),
    prisma.duesCharge.findMany({
      where: {
        organizationId,
        ...(memberId ? { memberId } : {}),
      },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        duesAccount: true,
      },
      take: 150,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Charges"
        description="Create member charges from dues accounts and monitor which balances remain open."
        actions={[
          { href: "/dues/payments", label: "Dues Payments" },
          { href: "/dues", label: "Back to Dues" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Charges" value={charges.length} />
        <StatCard label="Members" value={members.length} />
        <StatCard label="Active Accounts" value={accounts.length} />
        <StatCard label="Filtered Member" value={memberId ? "Yes" : "No"} helper={memberId || "All members"} />
      </div>

      <SectionCard title="Issue Charge" description="Charges stay tied to both the selected member and the dues account so account-level plans and member ledgers stay in sync.">
        <DuesChargesManager
          members={members}
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            memberId: account.memberId,
            categoryName: account.category?.name ?? null,
            amountDefault: account.amountDefault?.toString() ?? null,
            frequency: account.frequency,
          }))}
          charges={charges.map((charge) => ({
            ...charge,
            dueDate: charge.dueDate.toISOString(),
            amountDue: charge.amountDue.toString(),
            amountPaid: charge.amountPaid.toString(),
          }))}
          defaultMemberId={memberId}
          canWrite={canWrite}
        />
      </SectionCard>
    </main>
  );
}
