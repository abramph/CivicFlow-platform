import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { RemindersManager } from "@/components/forms/RemindersManager";

export default async function RemindersPage() {
  const { organizationId, can } = await requirePermission("reminders:read");
  const canWrite = can("reminders:send");
  const [rows, members] = await Promise.all([
    prisma.emailReminderLog.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { member: true },
      take: 100,
    }),
    prisma.orgMember.findMany({
      where: { organizationId },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true },
      take: 200,
    }),
  ]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Reminders"
        description="Queue reminder records for dues, receipts, and membership renewal follow-up."
        actions={[
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Queued Reminders" value={rows.filter((row) => row.status === "QUEUED").length} />
        <StatCard label="Sent Reminders" value={rows.filter((row) => row.status === "SENT").length} />
        <StatCard label="Members Available" value={members.length} />
      </div>

      <SectionCard title="Reminder Queue" description="Create a reminder log entry with member context, recipient email, subject, and preview copy.">
        <RemindersManager
          members={members}
          rows={rows.map((row) => ({
            id: row.id,
            reminderType: row.reminderType,
            status: row.status,
            recipientEmail: row.recipientEmail,
            subject: row.subject,
            createdAt: row.createdAt.toISOString(),
            sentAt: row.sentAt?.toISOString() ?? null,
            memberName: row.member ? `${row.member.firstName} ${row.member.lastName}` : null,
          }))}
          canWrite={canWrite}
        />
      </SectionCard>
    </main>
  );
}
