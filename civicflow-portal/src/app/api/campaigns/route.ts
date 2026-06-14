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

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalTextField(4000),
  goal: z.number().nonnegative().nullable().optional(),
  startDate: optionalDateTimeField,
  endDate: optionalDateTimeField,
  status: z.string().trim().min(1).max(40),
  notes: optionalTextField(4000),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("campaigns:read", "throw");

    const rows = await prisma.campaign.findMany({
      where: { organizationId },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: {
        _count: {
          select: {
            contributions: true,
          },
        },
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "campaign",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:campaigns:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("campaigns:write", "throw");
    const input = await parseJsonBody(request, createCampaignSchema);

    const startDate = normalizeOptionalDateTime(input.startDate);
    const endDate = normalizeOptionalDateTime(input.endDate);

    if (startDate && endDate && endDate < startDate) {
      throw new ValidationError("Campaign end date must be on or after the start date.");
    }

    const row = await prisma.campaign.create({
      data: {
        organizationId,
        name: input.name.trim(),
        description: normalizeOptionalText(input.description) ?? null,
        goal: input.goal ?? null,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        status: input.status.trim(),
        notes: normalizeOptionalText(input.notes) ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "campaign",
      entityId: row.id,
      metadata: {
        name: row.name,
        status: row.status,
        goal: row.goal?.toString() ?? null,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
