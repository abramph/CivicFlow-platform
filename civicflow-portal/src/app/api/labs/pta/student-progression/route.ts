import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PERMISSIONS } from "@/lib/rbac";
import { createProgressionBatch, listProgressionBatches } from "@/lib/labs/pta/student-progression";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/student-progression — the org's progression batches,
 * newest first. Preview-tier permission: any officer who can preview a
 * rollover can also see the list of past/in-progress ones. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const batches = await listProgressionBatches(organizationId);
    return Response.json({ ok: true, data: batches });
  });
}

const createSchema = z.object({
  fromSchoolYearId: z.string().min(1).max(64),
  toSchoolYearId: z.string().min(1).max(64),
  notes: z.string().max(8000).nullable().optional(),
});

/** POST — start a new progression batch for a (fromYear, toYear) pair.
 * Creating a batch is itself preview-tier (no target-year data is written
 * yet) — only commit requires the higher-risk permission. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess(PERMISSIONS.PTA_STUDENT_PROGRESSION_PREVIEW);
    const input = await parseJsonBody(request, createSchema);
    const batch = await createProgressionBatch({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: batch }, { status: 201 });
  });
}
