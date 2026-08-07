import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { WhatsAppOrganizationsTable } from "@/components/admin/WhatsAppOrganizationsTable";

export default async function WhatsAppOrganizationsPage() {
  await requireSuperAdmin();

  const organizations = await prisma.organization.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      whatsappSettings: {
        select: {
          whatsappAddOnActive: true,
          whatsappMonthlyLimit: true,
          whatsappUsedThisPeriod: true,
          whatsappOverageRateCents: true,
          suspendedAt: true,
          pilotMode: true,
          pausedAt: true,
          pauseReason: true,
          quietHoursStartHour: true,
          quietHoursEndHour: true,
        },
      },
    },
    take: 500,
  });

  return (
    <main className="space-y-6">
      <PageHeader
        title="WhatsApp Organizations"
        description="Manage each organization's WhatsApp add-on, usage limits, pilot status, and quiet hours."
        actions={[{ href: "/admin/platform/whatsapp", label: "Back to WhatsApp Administration" }]}
      />

      <SectionCard title={`${organizations.length} organizations`}>
        <WhatsAppOrganizationsTable
          organizations={organizations.map((org) => ({
            id: org.id,
            name: org.name,
            whatsappAddOnActive: org.whatsappSettings?.whatsappAddOnActive ?? false,
            whatsappMonthlyLimit: org.whatsappSettings?.whatsappMonthlyLimit ?? 0,
            whatsappUsedThisPeriod: org.whatsappSettings?.whatsappUsedThisPeriod ?? 0,
            whatsappOverageRateCents: org.whatsappSettings?.whatsappOverageRateCents ?? 0,
            suspendedAt: org.whatsappSettings?.suspendedAt?.toISOString() ?? null,
            pilotMode: org.whatsappSettings?.pilotMode ?? true,
            pausedAt: org.whatsappSettings?.pausedAt?.toISOString() ?? null,
            pauseReason: org.whatsappSettings?.pauseReason ?? null,
            quietHoursStartHour: org.whatsappSettings?.quietHoursStartHour ?? 21,
            quietHoursEndHour: org.whatsappSettings?.quietHoursEndHour ?? 8,
          }))}
        />
      </SectionCard>
    </main>
  );
}
