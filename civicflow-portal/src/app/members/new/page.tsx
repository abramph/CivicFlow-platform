import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { MemberCreateForm } from "@/components/forms/MemberCreateForm";
import { prisma } from "@/lib/prisma";

export default async function NewMemberPage() {
  const { organizationId } = await requirePermission("members:write");
  const [count, membershipCategories] = await Promise.all([
    prisma.orgMember.count({ where: { organizationId } }),
    prisma.category.findMany({
      where: {
        organizationId,
        type: "MEMBERSHIP",
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Create Member"
        description="Create a new organization-scoped member record with contact details, status, join date, and internal notes."
        actions={[
          { href: "/members", label: "Back to Members" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Current Members" value={count} helper="Existing member records in this organization." />
        <StatCard label="Required Fields" value="2" helper="First name and last name are required." />
        <StatCard
          label="Membership Categories"
          value={membershipCategories.length}
          helper="Active membership categories available for assignment."
        />
      </div>

      <SectionCard
        title="Member Information"
        description="Required fields are clearly marked. This form also captures address, category, household, emergency contact, and profile notes without breaking existing lightweight member creation."
      >
        <MemberCreateForm membershipCategories={membershipCategories} />
      </SectionCard>
    </main>
  );
}
