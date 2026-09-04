import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { commitProgressionBatch } from "@/lib/labs/pta/student-progression";
import { parseJsonBody, z } from "@/lib/validation";

const postSchema = z.object({
  /** The batch's previewedAt (ISO string) the caller last saw — Section 4
   * Step 4's "a fresh preview or a preview version that has not become
   * stale." Required, not defaulted: the caller must have actually fetched
   * a preview before this request can be built at all. */
  previewVersion: z.string().min(1).max(64),
  /** Section 4 Step 4's "a unique idempotency key." Required so a retried
   * HTTP request against an already-committed batch is a safe no-op
   * rather than a silent double-apply or a confusing error. */
  idempotencyKey: z.string().min(1).max(200),
});

/** POST /api/labs/pta/student-progression/:batchId/commit — the guarded
 * commit ceremony (Section 4 Step 4/5). Higher-risk, ORG_ADMIN/ORG_OWNER
 * -only permission — this is the org-wide, hard-to-fully-undo write. */
export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_COMMIT);
    const { batchId } = await params;
    const input = await parseJsonBody(request, postSchema);
    const result = await commitProgressionBatch({
      organizationId,
      batchId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
