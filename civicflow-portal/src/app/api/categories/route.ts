import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const categorySchema = z.object({
  name: z.string().trim().min(1).max(160),
  type: z.enum(["MEMBERSHIP", "DUES", "CONTRIBUTION", "EXPENDITURE", "EVENT", "CAMPAIGN"]),
  description: optionalTextField(4000),
  isActive: z.boolean().optional(),
  notes: optionalTextField(4000),
  amountDefault: z.number().nonnegative().nullable().optional(),
  frequency: optionalTextField(40),
  standardDuesCategoryId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  minAge: z.number().int().min(0).max(150).nullable().optional(),
  maxAge: z.number().int().min(0).max(150).nullable().optional(),
  autoAssignByAge: z.boolean().optional(),
  priority: z.number().int().min(0).max(10000).optional(),
  effectiveDate: z.union([z.string().datetime(), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:read", "throw");

    const rows = await prisma.category.findMany({
      where: { organizationId },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        standardDuesCategory: true,
        _count: {
          select: {
            members: true,
            duesAccounts: true,
          },
        },
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "category",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, categorySchema);

    const standardDuesCategoryId = normalizeOptionalText(input.standardDuesCategoryId);

    if (input.type === "MEMBERSHIP" && standardDuesCategoryId) {
      const linkedDues = await prisma.category.findFirst({
        where: {
          id: standardDuesCategoryId,
          organizationId,
          type: "DUES",
        },
      });

      if (!linkedDues) {
        throw new ValidationError("Standard dues category must reference an active organization dues category.");
      }
    }

    if (input.type !== "MEMBERSHIP" && standardDuesCategoryId) {
      throw new ValidationError("Only membership categories can reference a standard dues category.");
    }

    if (input.type !== "MEMBERSHIP" && (input.minAge !== undefined || input.maxAge !== undefined || input.autoAssignByAge)) {
      throw new ValidationError("Age-based assignment rules only apply to membership categories.");
    }

    if (input.minAge !== null && input.maxAge !== null && input.minAge !== undefined && input.maxAge !== undefined && input.minAge > input.maxAge) {
      throw new ValidationError("Minimum age cannot be greater than maximum age.");
    }

    const row = await prisma.category.create({
      data: {
        organizationId,
        name: input.name.trim(),
        type: input.type,
        description: normalizeOptionalText(input.description) ?? null,
        isActive: input.isActive ?? true,
        notes: normalizeOptionalText(input.notes) ?? null,
        amountDefault: input.amountDefault ?? null,
        frequency: normalizeOptionalText(input.frequency) ?? null,
        standardDuesCategoryId: standardDuesCategoryId ?? null,
        minAge: input.type === "MEMBERSHIP" ? input.minAge ?? null : null,
        maxAge: input.type === "MEMBERSHIP" ? input.maxAge ?? null : null,
        autoAssignByAge: input.type === "MEMBERSHIP" ? input.autoAssignByAge ?? false : false,
        priority: input.type === "MEMBERSHIP" ? input.priority ?? 0 : 0,
        effectiveDate:
          input.type === "MEMBERSHIP" && input.effectiveDate
            ? new Date(input.effectiveDate)
            : null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "category",
      entityId: row.id,
      metadata: {
        name: row.name,
        type: row.type,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
