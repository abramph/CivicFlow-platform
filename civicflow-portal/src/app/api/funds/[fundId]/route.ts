import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { updateFund } from "@/lib/giving/funds";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
  shortCode: z.string().max(20).nullable().optional(),
  isPublic: z.boolean().optional(),
  allowOneTime: z.boolean().optional(),
  allowRecurring: z.boolean().optional(),
  allowPledges: z.boolean().optional(),
  suggestedAmounts: z.array(z.number().positive().max(1_000_000)).max(8).optional(),
  minimumAmount: z.number().min(0).max(1_000_000).nullable().optional(),
  maximumAmount: z.number().min(0).max(10_000_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  accountingCode: z.string().max(64).nullable().optional(),
  /** Status machine only — there is deliberately no DELETE on funds. */
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "CLOSED", "ARCHIVED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ fundId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:funds:manage", "throw");
    const { fundId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const fund = await updateFund({
      organizationId,
      fundId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: fund });
  });
}
