import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import type { PaymentLinkType } from "@prisma/client";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const createPaymentLinkSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: optionalTextField(2000),
  linkType: z.enum(["GENERAL", "CAMPAIGN", "EVENT", "DUES"]).default("GENERAL"),
  amount: z.number().positive().nullable().optional(),
  minAmount: z.number().positive().nullable().optional(),
  campaignId: z.string().trim().min(1).nullable().optional(),
  eventId: z.string().trim().min(1).nullable().optional(),
  expiresAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
  paymentMethodConfigIds: z.array(z.string().trim().min(1)).min(1, "Select at least one payment method."),
});

function generateSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const random = Math.random().toString(36).slice(2, 8);
  return `${base}-${random}`;
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:read", "throw");

    const rows = await prisma.paymentLink.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        methods: { include: { paymentMethodConfig: { select: { method: true, label: true } } } },
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "payment_link",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-links:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const input = await parseJsonBody(request, createPaymentLinkSchema);

    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({
        where: { id: input.campaignId, organizationId },
      });
      if (!campaign) throw new ValidationError("Campaign not found.");
    }

    if (input.eventId) {
      const event = await prisma.event.findFirst({
        where: { id: input.eventId, organizationId },
      });
      if (!event) throw new ValidationError("Event not found.");
    }

    const methodConfigs = await prisma.paymentMethodConfig.findMany({
      where: { id: { in: input.paymentMethodConfigIds }, organizationId, isActive: true },
    });
    if (methodConfigs.length !== input.paymentMethodConfigIds.length) {
      throw new ValidationError("One or more selected payment methods are invalid or inactive.");
    }

    let slug = generateSlug(input.title);
    // Retry once on the unlikely collision
    const existing = await prisma.paymentLink.findUnique({ where: { slug } });
    if (existing) slug = generateSlug(input.title);

    const row = await prisma.paymentLink.create({
      data: {
        organizationId,
        slug,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        linkType: (input.linkType ?? "GENERAL") as PaymentLinkType,
        amount: input.amount ?? null,
        minAmount: input.minAmount ?? null,
        campaignId: input.campaignId ?? null,
        eventId: input.eventId ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdByUserId: session.userId,
        methods: {
          create: methodConfigs.map((config) => ({ paymentMethodConfigId: config.id })),
        },
      },
      include: { methods: { include: { paymentMethodConfig: { select: { method: true, label: true } } } } },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "payment_link",
      entityId: row.id,
      metadata: { title: row.title, slug: row.slug, linkType: row.linkType },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
