import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

const optionalDateTimeField = z.union([z.string().datetime(), z.literal(""), z.null()]).optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalDateTime(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(value);
}

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: optionalTextField(4000),
  goal: z.number().nonnegative().nullable().optional(),
  startDate: optionalDateTimeField,
  endDate: optionalDateTimeField,
  status: z.string().trim().min(1).max(40).optional(),
  notes: optionalTextField(4000),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("campaigns:read", "throw");
    const { id } = await params;

    const row = await prisma.campaign.findFirst({
      where: { id, organizationId },
      include: {
        _count: {
          select: {
            contributions: true,
          },
        },
      },
    });

    if (!row) {
      return Response.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    }

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "read",
      entityType: "campaign",
      entityId: row.id,
    });

    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:campaigns:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("campaigns:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateCampaignSchema);

    const existing = await prisma.campaign.findFirst({ where: { id, organizationId } });
    if (!existing) {
      return Response.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    }

    const startDate =
      input.startDate !== undefined ? normalizeOptionalDateTime(input.startDate) : existing.startDate;
    const endDate =
      input.endDate !== undefined ? normalizeOptionalDateTime(input.endDate) : existing.endDate;

    if (startDate && endDate && endDate < startDate) {
      throw new ValidationError("Campaign end date must be on or after the start date.");
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: normalizeOptionalText(input.description) } : {}),
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.startDate !== undefined ? { startDate: normalizeOptionalDateTime(input.startDate) } : {}),
        ...(input.endDate !== undefined ? { endDate: normalizeOptionalDateTime(input.endDate) } : {}),
        ...(input.status !== undefined ? { status: input.status.trim() } : {}),
        ...(input.notes !== undefined ? { notes: normalizeOptionalText(input.notes) } : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "campaign",
      entityId: updated.id,
      metadata: {
        before: {
          name: existing.name,
          status: existing.status,
          goal: existing.goal?.toString() ?? null,
        },
        after: {
          name: updated.name,
          status: updated.status,
          goal: updated.goal?.toString() ?? null,
        },
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}
