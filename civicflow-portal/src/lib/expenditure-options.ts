import { prisma } from "@/lib/prisma";

export async function getExpenditureFormOptions(organizationId: string) {
  const [categories, paymentMethods, campaigns, events] = await Promise.all([
    prisma.category.findMany({
      where: { organizationId, type: "EXPENDITURE", isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.paymentMethodConfig.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true },
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 150,
    }),
    prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { title: "asc" }],
      select: { id: true, title: true },
      take: 150,
    }),
  ]);
  return {
    categories: categories.map((row) => ({ id: row.id, label: row.name })),
    paymentMethods: paymentMethods.map((row) => ({ id: row.id, label: row.label })),
    campaigns: campaigns.map((row) => ({ id: row.id, label: row.name })),
    events: events.map((row) => ({ id: row.id, label: row.title })),
  };
}

