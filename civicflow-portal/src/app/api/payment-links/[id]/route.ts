import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import type { PaymentLinkType, PaymentLinkStatus } from "@prisma/client";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const updatePaymentLinkSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: optionalTextField(2000),
  linkType: z.enum(["GENERAL", "CAMPAIGN", "EVENT", "DUES"]).optional(),
  amount: z.number().positive().nullable().optional(),
  minAmount: z.number().positive().nullable().optional(),
  campaignId: z.string().trim().min(1).nullable().optional(),
  eventId: z.string().trim().min(1).nullable().optional(),
  status: z.enum(["active", "inactive", "archived"]).optional(),
  expiresAt: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("contributions:read", "throw");
    const { id } = await params;

    const row = await prisma.paymentLink.findFirst({
      where: { id, organizationId },
      include: {
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
      },
    });

    if (!row) return Response.json({ ok: false, error: "Payment link not found" }, { status: 404 });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "read",
      entityType: "payment_link",
      entityId: row.id,
    });

    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-links:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updatePaymentLinkSchema);

    const existing = await prisma.paymentLink.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Payment link not found" }, { status: 404 });

    const updated = await prisma.paymentLink.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.linkType !== undefined ? { linkType: input.linkType as PaymentLinkType } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.minAmount !== undefined ? { minAmount: input.minAmount } : {}),
        ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
        ...(input.status !== undefined ? { status: input.status as PaymentLinkStatus } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "payment_link",
      entityId: updated.id,
      metadata: {
        before: { title: existing.title, status: existing.status },
        after: { title: updated.title, status: updated.status },
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:payment-links:write",
      request: _request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("contributions:write", "throw");
    const { id } = await params;

    const existing = await prisma.paymentLink.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Payment link not found" }, { status: 404 });

    // Archive instead of hard-delete to preserve use count history
    const updated = await prisma.paymentLink.update({
      where: { id },
      data: { status: "archived" },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "delete",
      entityType: "payment_link",
      entityId: id,
      metadata: { title: existing.title, slug: existing.slug },
    });

    return Response.json({ ok: true, data: updated });
  });
}
