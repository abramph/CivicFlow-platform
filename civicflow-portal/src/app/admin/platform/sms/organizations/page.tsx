import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { SmsOrganizationsTable } from "@/components/admin/SmsOrganizationsTable";

export default async function SmsOrganizationsPage() {
  await requireSuperAdmin();

  const organizations = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      smsSettings: {
        select: {
          smsAddOnActive: true,
          plan: true,
          planPriceCents: true,
          smsMonthlyLimit: true,
          smsUsedThisPeriod: true,
          smsOverageRateCents: true,
          suspendedAt: true,
        },
      },
    },
    take: 500,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="SMS Organizations"
        description="Manage each organization's SMS plan, usage limits, and messaging status."
        actions={[{ href: "/admin/platform/sms", label: "Back to SMS Administration" }]}
      />

      <SectionCard title={`${organizations.length} organizations`}>
        <SmsOrganizationsTable
          organizations={organizations.map((org) => ({
            id: org.id,
            name: org.name,
            smsAddOnActive: org.smsSettings?.smsAddOnActive ?? false,
            plan: org.smsSettings?.plan ?? null,
            planPriceCents: org.smsSettings?.planPriceCents ?? 0,
            smsMonthlyLimit: org.smsSettings?.smsMonthlyLimit ?? 0,
            smsUsedThisPeriod: org.smsSettings?.smsUsedThisPeriod ?? 0,
            smsOverageRateCents: org.smsSettings?.smsOverageRateCents ?? 0,
            suspendedAt: org.smsSettings?.suspendedAt?.toISOString() ?? null,
          }))}
        />
      </SectionCard>
    </main>
  );
}
