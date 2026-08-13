import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { completeComplianceRequirement, updateComplianceRequirement } from "@/lib/labs/pta/compliance";
import { parseJsonBody, z } from "@/lib/validation";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  ownerName: z.string().max(120).nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  recurrence: z.enum(["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"]).optional(),
  isApplicable: z.boolean().optional(),
  notes: z.string().max(4000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  /** Mark done now: stamps completion and advances a recurring due date. */
  complete: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ requirementId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const { requirementId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const actor = { actorUserId: session.userId, actorEmail: session.userEmail };
    const { complete, ...rest } = input;
    if (complete) {
      const requirement = await completeComplianceRequirement({ organizationId, requirementId, ...actor });
      return Response.json({ ok: true, data: requirement });
    }
    const requirement = await updateComplianceRequirement({ organizationId, requirementId, ...rest, ...actor });
    return Response.json({ ok: true, data: requirement });
  });
}
