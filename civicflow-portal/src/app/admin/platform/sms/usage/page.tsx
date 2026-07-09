import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { prisma } from "@/lib/prisma";
import {
  CostByMonthChart,
  DeliveredVsFailedChart,
  MessagesPerDayChart,
  TopOrgsByUsageChart,
} from "@/components/admin/SmsUsageCharts";

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function SmsUsagePage() {
  await requireSuperAdmin();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [perDayRows, statusRows, costRows, topOrgGroups] = await Promise.all([
    prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt")::date AS day, COUNT(*)::int AS count
      FROM "SmsMessage"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY day ORDER BY day ASC
    `,
    prisma.$queryRaw<{ day: Date; status: string; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt")::date AS day, status, COUNT(*)::int AS count
      FROM "SmsMessage"
      WHERE "createdAt" >= ${fourteenDaysAgo} AND status IN ('DELIVERED', 'FAILED')
      GROUP BY day, status ORDER BY day ASC
    `,
    prisma.$queryRaw<{ month: Date; cost: bigint }[]>`
      SELECT DATE_TRUNC('month', "createdAt")::date AS month, SUM(COALESCE("actualCostCents", "costEstimateCents", 0))::int AS cost
      FROM "SmsMessage"
      WHERE "createdAt" >= ${sixMonthsAgo}
      GROUP BY month ORDER BY month ASC
    `,
    prisma.smsMessage.groupBy({
      by: ["organizationId"],
      where: { createdAt: { gte: monthStart } },
      _count: { _all: true },
      orderBy: { _count: { organizationId: "desc" } },
      take: 8,
    }),
  ]);

  const orgNames = await prisma.organization.findMany({
    where: { id: { in: topOrgGroups.map((g) => g.organizationId) } },
    select: { id: true, name: true },
  });
  const orgNameById = new Map(orgNames.map((o) => [o.id, o.name]));

  const messagesPerDay = perDayRows.map((row) => ({ day: isoDay(row.day), count: Number(row.count) }));

  const deliveredVsFailedByDay = new Map<string, { delivered: number; failed: number }>();
  for (const row of statusRows) {
    const key = isoDay(row.day);
    const entry = deliveredVsFailedByDay.get(key) ?? { delivered: 0, failed: 0 };
    if (row.status === "DELIVERED") entry.delivered = Number(row.count);
    if (row.status === "FAILED") entry.failed = Number(row.count);
    deliveredVsFailedByDay.set(key, entry);
  }
  const deliveredVsFailed = Array.from(deliveredVsFailedByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({ day, ...counts }));

  const costByMonth = costRows.map((row) => ({
    month: row.month.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    costCents: Number(row.cost),
  }));

  const topOrgs = topOrgGroups.map((group) => ({
    name: orgNameById.get(group.organizationId) ?? "Unknown organization",
    count: group._count._all,
  }));

  return (
    <main className="space-y-6">
      <PageHeader
        title="SMS Usage Dashboard"
        description="Volume, delivery, cost, and top-organization trends across the platform."
        actions={[{ href: "/admin/platform/sms", label: "Back to SMS Administration" }]}
      />

      <SectionCard title="Messages Per Day" description="Last 30 days.">
        <MessagesPerDayChart data={messagesPerDay} />
      </SectionCard>

      <SectionCard title="Delivery Rate" description="Delivered vs. failed messages per day, last 14 days.">
        <DeliveredVsFailedChart data={deliveredVsFailed} />
      </SectionCard>

      <SectionCard title="Cost by Month" description="Twilio cost (actual where known, else estimated), last 6 months.">
        <CostByMonthChart data={costByMonth} />
      </SectionCard>

      <SectionCard title="Top Organizations by Usage" description="Message volume this month, top 8 organizations.">
        <TopOrgsByUsageChart data={topOrgs} />
      </SectionCard>
    </main>
  );
}
