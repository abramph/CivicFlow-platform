import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { CategoryManager } from "@/components/forms/CategoryManager";
import { RunCategoryRulesButton } from "@/components/forms/MembershipRuleActions";

export default async function CategoriesSettingsPage() {
  const { organizationId } = await requirePermission("org_settings:read");

  const categories = await prisma.category.findMany({
    where: { organizationId },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      standardDuesCategory: true,
      _count: {
        select: {
          members: true,
          duesAccounts: true,
        },
      },
    },
  });

  const duesCategories = categories
    .filter((category) => category.type === "DUES")
    .map((category) => ({ id: category.id, name: category.name }));

  return (
    <main className="space-y-6">
      <PageHeader
        title="Categories"
        description="Manage membership, dues, contribution, expenditure, event, and campaign categories used throughout the SaaS portal."
        actions={[
          { href: "/settings/dues", label: "Dues Setup" },
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Categories" value={categories.length} />
        <StatCard label="Membership Categories" value={categories.filter((category) => category.type === "MEMBERSHIP").length} />
        <StatCard label="Dues Categories" value={duesCategories.length} />
        <StatCard label="Active Categories" value={categories.filter((category) => category.isActive).length} />
      </div>

      <SectionCard title="Category Setup" description="Category setup drives desktop-style organization structure, including membership classification and category-linked dues defaults.">
        <div className="mb-5">
          <RunCategoryRulesButton />
        </div>
        <CategoryManager
          categories={categories.map((category) => ({
            ...category,
            amountDefault: category.amountDefault?.toString() ?? null,
            effectiveDate: category.effectiveDate?.toISOString() ?? null,
            memberCount: category._count.members,
            duesAccountCount: category._count.duesAccounts,
          }))}
          duesCategories={duesCategories}
          initialType="MEMBERSHIP"
        />
      </SectionCard>
    </main>
  );
}
