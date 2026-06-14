import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { DuesAccountsManager } from "@/components/forms/DuesAccountsManager";

export default async function DuesAccountsPage() {
  const { organizationId } = await requirePermission("dues:read");

  const [members, duesCategories, accounts] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, preferredName: true },
      take: 200,
    }),
    prisma.category.findMany({
      where: {
        organizationId,
        type: "DUES",
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        frequency: true,
        amountDefault: true,
      },
      take: 100,
    }),
    prisma.duesAccount.findMany({
      where: { organizationId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        category: true,
        _count: {
          select: {
            charges: true,
          },
        },
      },
      take: 150,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Dues Accounts"
        description="Create and manage dues accounts tied to members or shared category-based plans."
        actions={[
          { href: "/settings/dues", label: "Dues Setup" },
          { href: "/dues", label: "Back to Dues" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Dues Accounts" value={accounts.length} />
        <StatCard label="Members Available" value={members.length} />
        <StatCard label="Dues Categories" value={duesCategories.length} />
      </div>

      <SectionCard title="Account Setup" description="Use dues accounts to define the recurring amount and frequency that should be charged to a member or shared group.">
        <DuesAccountsManager
          members={members}
          duesCategories={duesCategories.map((category) => ({
            ...category,
            amountDefault: category.amountDefault?.toString() ?? null,
          }))}
          accounts={accounts.map((account) => ({
            id: account.id,
            name: account.name,
            member: account.member,
            category: account.category
              ? {
                  id: account.category.id,
                  name: account.category.name,
                  frequency: account.category.frequency,
                  amountDefault: account.category.amountDefault?.toString() ?? null,
                }
              : null,
            amountDefault: account.amountDefault?.toString() ?? null,
            frequency: account.frequency,
            isActive: account.isActive,
            notes: account.notes,
            chargeCount: account._count.charges,
          }))}
        />
      </SectionCard>
    </main>
  );
}
