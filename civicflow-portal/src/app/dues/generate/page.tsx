import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { DuesGenerateForm } from "@/components/forms/DuesGenerateForm";

export default async function GenerateDuesPage() {
  const { organizationId } = await requirePermission("dues:write");
  const members = await prisma.orgMember.findMany({
    where: { organizationId, membershipStatus: { in: ["active", "pending"] } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
    take: 1000,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="Generate Dues Charges"
        description="Create missing dues charges from member join dates and current dues plans without duplicating existing periods."
        actions={[
          { href: "/dues", label: "Back to Dues" },
          { href: "/settings/dues", label: "Dues Settings" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />
      <SectionCard title="Generate Missing Dues" description="Run for all active members or a selected member over a date range.">
        <DuesGenerateForm members={members} canWrite />
      </SectionCard>
    </main>
  );
}
