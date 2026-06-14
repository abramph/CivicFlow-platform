import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const updatePaymentMethodSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  instructions: z.union([z.string().trim().max(1000), z.literal(""), z.null()]).optional(),
  accountIdentifier: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
  notes: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updatePaymentMethodSchema);

    const existing = await prisma.paymentMethodConfig.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      return Response.json({ ok: false, error: "Payment method not found" }, { status: 404 });
    }

    const updated = await prisma.paymentMethodConfig.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.instructions !== undefined ? { instructions: normalizeOptionalText(input.instructions) } : {}),
        ...(input.accountIdentifier !== undefined ? { accountIdentifier: normalizeOptionalText(input.accountIdentifier) } : {}),
        ...(input.notes !== undefined ? { notes: normalizeOptionalText(input.notes) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: updated.isActive ? "update" : "deactivate",
      entityType: "payment_method_config",
      entityId: updated.id,
      metadata: {
        before: {
          label: existing.label,
          accountIdentifier: existing.accountIdentifier,
          isActive: existing.isActive,
        },
        after: {
          label: updated.label,
          accountIdentifier: updated.accountIdentifier,
          isActive: updated.isActive,
        },
      },
    });

    return Response.json({ ok: true, data: updated });
  });
}
