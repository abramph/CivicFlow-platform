import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/sms-otp";
import { SmsQueueTable } from "@/components/admin/SmsQueueTable";

const STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "FAILED", "RETRYING"] as const;

export default async function SmsQueuePage() {
  await requireSuperAdmin();

  const [counts, recentMessages] = await Promise.all([
    Promise.all(STATUSES.map((status) => prisma.smsMessage.count({ where: { status } }))),
    prisma.smsMessage.findMany({
      where: { status: { in: ["QUEUED", "SENDING", "FAILED", "RETRYING"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { organization: { select: { name: true } } },
    }),
  ]);

  const countsByStatus = Object.fromEntries(STATUSES.map((status, index) => [status, counts[index]]));

  return (
    <main className="space-y-6">
      <PageHeader
        title="SMS Message Queue"
        description="Live status of in-flight and recently failed messages, with retry/cancel controls."
        actions={[
          { href: "/admin/platform/sms/logs", label: "Full Logs" },
          { href: "/admin/platform/sms", label: "Back to SMS Administration" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Pending" value={countsByStatus.QUEUED} />
        <StatCard label="Sending" value={countsByStatus.SENDING} />
        <StatCard label="Sent" value={countsByStatus.SENT} />
        <StatCard label="Delivered" value={countsByStatus.DELIVERED} />
        <StatCard label="Failed" value={countsByStatus.FAILED} />
        <StatCard label="Retrying" value={countsByStatus.RETRYING} />
      </div>

      <SectionCard title="Needs attention" description="Queued, sending, failed, and retrying messages (most recent 100).">
        <SmsQueueTable
          messages={recentMessages.map((m) => ({
            id: m.id,
            organizationName: m.organization.name,
            phone: maskPhone(m.phone),
            status: m.status,
            errorMessage: m.errorMessage,
            retryCount: m.retryCount,
            createdAt: m.createdAt.toISOString(),
          }))}
        />
      </SectionCard>
    </main>
  );
}
