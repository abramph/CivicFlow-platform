import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";
import { ImportError } from "@/lib/imports/errors";
import type { ImportRowDecision } from "@prisma/client";

const decideSchema = z.object({
  decision: z.enum(["IMPORT_NEW", "SKIP", "UPDATE_EXISTING", "CREATE_ANYWAY", "REVIEW_REQUIRED"]),
});

/**
 * UPDATE_EXISTING/CREATE_ANYWAY are gated behind imports:resolve-duplicates
 * (the higher-authority tier — actually deciding what to do with a
 * duplicate/possible-match, per Phase 13's requested permission set) while
 * IMPORT_NEW/SKIP/REVIEW_REQUIRED only require imports:review.
 */
const RESOLVE_DUPLICATE_DECISIONS: ImportRowDecision[] = ["UPDATE_EXISTING", "CREATE_ANYWAY"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const limited = await requireRateLimit({ scope: "api:imports:decide", request, limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("imports:review", "throw");
    const { id, rowId } = await params;
    const input = await parseJsonBody(request, decideSchema);

    if (RESOLVE_DUPLICATE_DECISIONS.includes(input.decision) && !can("imports:resolve-duplicates")) {
      return Response.json(
        { ok: false, error: "Resolving a duplicate this way requires additional permission.", code: "IMPORT_VALIDATION_ERROR" },
        { status: 403 }
      );
    }

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    if (batch.status !== "READY_FOR_REVIEW") {
      throw new ImportError(
        "IMPORT_STALE_DECISION",
        `This batch is ${batch.status} — decisions can only be recorded while it's ready for review.`
      );
    }

    const row = await prisma.importRow.findFirst({ where: { id: rowId, batchId: id, organizationId } });
    if (!row) throw new ImportError("IMPORT_CROSS_TENANT_ACCESS", "Import row not found.");
    if (["IMPORTED", "SKIPPED", "FAILED", "BLOCKED_PLAN_LIMIT"].includes(row.status)) {
      throw new ImportError("IMPORT_ROW_ALREADY_PROCESSED", "This row has already been processed and can no longer be redecided.");
    }

    const updated = await prisma.importRow.update({
      where: { id: rowId },
      data: { decision: input.decision, decidedByUserId: session.userId, decidedAt: new Date() },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "import_row.decided",
      entityType: "import_row",
      entityId: rowId,
      metadata: { batchId: id, rowNumber: row.rowNumber, status: row.status, decision: input.decision },
    });

    return Response.json({ ok: true, data: { id: updated.id, decision: updated.decision } });
  });
}
