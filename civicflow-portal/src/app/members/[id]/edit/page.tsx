import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { MemberEditForm } from "@/components/forms/MemberEditForm";
import { prisma } from "@/lib/prisma";
import { formatDateInputValue } from "@/lib/formatting";

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { organizationId } = await requirePermission("members:write");
  const { id } = await params;

  const [member, membershipCategories] = await Promise.all([
    prisma.orgMember.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        email: true,
        phone: true,
        membershipStatus: true,
        membershipCategoryId: true,
        membershipCategoryManualOverride: true,
        joinDate: true,
        dateOfBirth: true,
        gender: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zipCode: true,
        county: true,
        country: true,
        householdName: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        notes: true,
      },
    }),
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

  if (!member) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Member not found"
          description="The member you are trying to edit is unavailable in your organization."
          actions={[
            { href: "/members", label: "Back to Members" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Edit Member"
        description="Update the member record using the protected SaaS member API."
        actions={[
          { href: `/members/${member.id}`, label: "Back to Member" },
          { href: "/members", label: "Back to Members" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <SectionCard title="Member Form" description="Changes save through the existing PATCH /api/members/[id] route.">
        <MemberEditForm
          member={{
            ...member,
            joinDate: formatDateInputValue(member.joinDate),
            dateOfBirth: formatDateInputValue(member.dateOfBirth),
          }}
          membershipCategories={membershipCategories}
        />
      </SectionCard>
    </main>
  );
}
