import { withApiErrorHandling } from "@/lib/api-route";
import { requireConcernAccess } from "@/lib/labs/pta/guard";
import { getConcern, updateConcern } from "@/lib/labs/pta/concerns";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/concerns/:id — full case detail. Every successful read
 * is audited by the lib; restricted cases 404 for non-assignees. */
export async function GET(_request: Request, { params }: { params: Promise<{ concernId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const { concernId } = await params;
    const concern = await getConcern(organizationId, concernId, viewer);
    return Response.json({ ok: true, data: concern });
  });
}

const CONCERN_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFORMAL_RESOLUTION",
  "FORMAL_REVIEW",
  "AWAITING_RESPONSE",
  "RESOLVED",
  "DISMISSED",
  "APPEALED",
  "CLOSED",
] as const;

const patchSchema = z.object({
  status: z.enum(CONCERN_STATUSES).optional(),
  responseDeadline: z.coerce.date().nullable().optional(),
  assignedCommitteeId: z.string().max(64).nullable().optional(),
  applicableGovernanceDocumentId: z.string().max(64).nullable().optional(),
  isRestricted: z.boolean().optional(),
  resolution: z.string().max(20000).nullable().optional(),
  appealNotes: z.string().max(20000).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ concernId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, viewer } = await requireConcernAccess();
    const { concernId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const concern = await updateConcern({ organizationId, concernId, ...input, actor: viewer });
    return Response.json({ ok: true, data: concern });
  });
}
