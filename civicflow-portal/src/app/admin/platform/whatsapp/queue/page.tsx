import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/sms-otp";
import { WhatsAppQueueTable } from "@/components/admin/WhatsAppQueueTable";

const STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "UNDELIVERED"] as const;

export default async function WhatsAppQueuePage() {
  await requireSuperAdmin();

  const [counts, recentMessages] = await Promise.all([
    Promise.all(STATUSES.map((status) => prisma.whatsAppMessage.count({ where: { status } }))),
    prisma.whatsAppMessage.findMany({
      where: { status: { in: ["QUEUED", "SENDING", "FAILED", "UNDELIVERED"] } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { organization: { select: { name: true } } },
    }),
  ]);

  const countsByStatus = Object.fromEntries(STATUSES.map((status, index) => [status, counts[index]]));

  return (
    <main className="space-y-6">
      <PageHeader
        title="WhatsApp Message Queue"
        description="Live status of in-flight and recently failed messages, with retry/cancel controls."
        actions={[
          { href: "/admin/platform/whatsapp/logs", label: "Full Logs" },
          { href: "/admin/platform/whatsapp", label: "Back to WhatsApp Administration" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
        <StatCard label="Pending" value={countsByStatus.QUEUED} />
        <StatCard label="Sending" value={countsByStatus.SENDING} />
        <StatCard label="Sent" value={countsByStatus.SENT} />
        <StatCard label="Delivered" value={countsByStatus.DELIVERED} />
        <StatCard label="Read" value={countsByStatus.READ} />
        <StatCard label="Failed" value={countsByStatus.FAILED} />
        <StatCard label="Undelivered" value={countsByStatus.UNDELIVERED} />
      </div>

      <SectionCard title="Needs attention" description="Queued, sending, failed, and undelivered messages (most recent 100).">
        <WhatsAppQueueTable
          messages={recentMessages.map((m) => ({
            id: m.id,
            organizationName: m.organization.name,
            phone: maskPhone(m.phone),
            status: m.status,
            errorMessage: m.errorMessage,
            retryCount: m.retryCount,
            createdAt: m.createdAt.toISOString(),
            // Never sent to the client as raw content -- only whether a
            // literal body exists, since template-based sends can't be
            // retried (no stored content) and the retry button needs to
            // know that without ever seeing the message text itself.
            canRetry: m.body !== null,
          }))}
        />
      </SectionCard>
    </main>
  );
}
