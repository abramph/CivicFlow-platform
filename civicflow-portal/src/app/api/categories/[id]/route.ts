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

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateCategorySchema);

    const existing = await prisma.category.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      return Response.json({ ok: false, error: "Category not found" }, { status: 404 });
    }

    const standardDuesCategoryId = normalizeOptionalText(input.standardDuesCategoryId);

    if ((existing.type === "MEMBERSHIP" || input.standardDuesCategoryId !== undefined) && standardDuesCategoryId) {
      const linkedDues = await prisma.category.findFirst({
        where: {
          id: standardDuesCategoryId,
          organizationId,
          type: "DUES",
        },
      });

      if (!linkedDues) {
        throw new ValidationError("Standard dues category must reference an organization dues category.");
      }
    }

    if (existing.type !== "MEMBERSHIP" && standardDuesCategoryId) {
      throw new ValidationError("Only membership categories can reference a standard dues category.");
    }

    if (
      existing.type !== "MEMBERSHIP" &&
      (input.minAge !== undefined || input.maxAge !== undefined || input.autoAssignByAge !== undefined)
    ) {
      throw new ValidationError("Age-based assignment rules only apply to membership categories.");
    }

    const nextMinAge = input.minAge !== undefined ? input.minAge : existing.minAge;
    const nextMaxAge = input.maxAge !== undefined ? input.maxAge : existing.maxAge;
    if (nextMinAge !== null && nextMaxAge !== null && nextMinAge > nextMaxAge) {
      throw new ValidationError("Minimum age cannot be greater than maximum age.");
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: normalizeOptionalText(input.description) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.notes !== undefined ? { notes: normalizeOptionalText(input.notes) } : {}),
        ...(input.amountDefault !== undefined ? { amountDefault: input.amountDefault } : {}),
        ...(input.frequency !== undefined ? { frequency: normalizeOptionalText(input.frequency) } : {}),
        ...(input.standardDuesCategoryId !== undefined
          ? { standardDuesCategoryId: standardDuesCategoryId ?? null }
          : {}),
        ...(input.minAge !== undefined ? { minAge: input.minAge } : {}),
        ...(input.maxAge !== undefined ? { maxAge: input.maxAge } : {}),
        ...(input.autoAssignByAge !== undefined ? { autoAssignByAge: input.autoAssignByAge } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.effectiveDate !== undefined
          ? { effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null }
          : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "category",
      entityId: updated.id,
      metadata: {
        before: {
          name: existing.name,
          isActive: existing.isActive,
        },
        after: {
          name: updated.name,
          isActive: updated.isActive,
        },
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}
