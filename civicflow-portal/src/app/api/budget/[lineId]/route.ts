import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { updateBudgetLine } from "@/lib/budget";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  categoryId: z.string().max(64).nullable().optional(),
  plannedAmount: z.number().min(0).max(100_000_000).optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  /** Deactivating hides the line from the budget — nothing is deleted. */
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("budget:manage", "throw");
    const { lineId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const line = await updateBudgetLine({
      organizationId,
      lineId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: line });
  });
}
