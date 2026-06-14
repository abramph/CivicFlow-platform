import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

const expenditureSchema = z.object({
  date: z.string().datetime(),
  vendor: optionalText(255),
  categoryId: optionalId,
  category: optionalText(160),
  amount: z.number().positive(),
  paymentMethodId: optionalId,
  paymentMethod: optionalText(120),
  description: z.string().trim().min(1).max(1000),
  notes: optionalText(4000),
  reference: optionalText(160),
  receiptUrl: optionalText(500),
  campaignId: optionalId,
  eventId: optionalId,
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function ensureReference(model: "category" | "paymentMethod" | "campaign" | "event", id: string | null | undefined, organizationId: string) {
  if (!id) return;
  const found =
    model === "category"
      ? await prisma.category.findFirst({ where: { id, organizationId, type: "EXPENDITURE" }, select: { id: true, name: true } })
      : model === "paymentMethod"
        ? await prisma.paymentMethodConfig.findFirst({ where: { id, organizationId }, select: { id: true, label: true } })
        : model === "campaign"
          ? await prisma.campaign.findFirst({ where: { id, organizationId }, select: { id: true } })
          : await prisma.event.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!found) throw new Error(`${model} not found in organization`);
  return found;
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("expenditures:read", "throw");
    const rows = await prisma.expenditure.findMany({
      where: { organizationId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true },
      take: 200,
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "list", entityType: "expenditure", metadata: { count: rows.length } });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("expenditures:write", "throw");
    const input = await parseJsonBody(request, expenditureSchema);
    const categoryId = text(input.categoryId);
    const paymentMethodId = text(input.paymentMethodId);
    const campaignId = text(input.campaignId);
    const eventId = text(input.eventId);

    const category = await ensureReference("category", categoryId, organizationId) as { name?: string } | undefined;
    const paymentMethod = await ensureReference("paymentMethod", paymentMethodId, organizationId) as { label?: string } | undefined;
    await ensureReference("campaign", campaignId, organizationId);
    await ensureReference("event", eventId, organizationId);

    const row = await prisma.expenditure.create({
      data: {
        organizationId,
        date: new Date(input.date),
        vendor: text(input.vendor),
        categoryId,
        category: category?.name ?? text(input.category),
        amount: input.amount,
        paymentMethodId,
        paymentMethod: paymentMethod?.label ?? text(input.paymentMethod),
        description: input.description.trim(),
        notes: text(input.notes),
        reference: text(input.reference),
        receiptUrl: text(input.receiptUrl),
        campaignId,
        eventId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "expenditure",
      entityId: row.id,
      metadata: { amount: row.amount.toString(), date: row.date.toISOString(), vendor: row.vendor },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}

