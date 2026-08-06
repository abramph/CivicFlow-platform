import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";
import { ImportError } from "@/lib/imports/errors";
import type { ImportRowDecision, ImportRowStatus } from "@prisma/client";

const decideSchema = z.object({
  decision: z.enum(["IMPORT_NEW", "SKIP", "UPDATE_EXISTING", "CREATE_ANYWAY", "REVIEW_REQUIRED"]),
});

/**
 * Which decisions are even semantically valid for a row's current status,
 * independent of permission. This is the fix for a real authorization
 * bypass: previously the route only checked whether the submitted decision
 * VALUE required imports:resolve-duplicates, never whether that decision
 * made sense for the row's actual status. That let an imports:review-only
 * caller submit decision=IMPORT_NEW on an UPDATE_AVAILABLE row (an existing
 * member match) — executeBatch() treats IMPORT_NEW exactly like a NEW row
 * and creates a brand-new OrgMember, fully bypassing the higher-authority
 * imports:resolve-duplicates gate meant to guard exactly this decision.
 * IMPORT_NEW is now only a legal decision for a genuinely NEW row.
 */
const VALID_DECISIONS_FOR_STATUS: Partial<Record<ImportRowStatus, ImportRowDecision[]>> = {
  NEW: ["IMPORT_NEW", "SKIP", "REVIEW_REQUIRED"],
  UPDATE_AVAILABLE: ["UPDATE_EXISTING", "CREATE_ANYWAY", "SKIP", "REVIEW_REQUIRED"],
  EXACT_DUPLICATE: ["SKIP", "CREATE_ANYWAY", "REVIEW_REQUIRED"],
  POSSIBLE_DUPLICATE: ["UPDATE_EXISTING", "CREATE_ANYWAY", "SKIP", "REVIEW_REQUIRED"],
};

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

    // Validated against the row's actual status BEFORE the permission check
    // below — a decision that isn't even semantically legal for this row
    // (e.g. IMPORT_NEW on a row that already matched an existing member)
    // must never reach executeBatch() regardless of who submitted it.
    const validDecisions = VALID_DECISIONS_FOR_STATUS[row.status] ?? [];
    if (!validDecisions.includes(input.decision)) {
      throw new ImportError(
        "IMPORT_VALIDATION_ERROR",
        `"${input.decision}" is not a valid decision for a row with status ${row.status}.`
      );
    }

    if (RESOLVE_DUPLICATE_DECISIONS.includes(input.decision) && !can("imports:resolve-duplicates")) {
      return Response.json(
        { ok: false, error: "Resolving a duplicate this way requires additional permission.", code: "IMPORT_VALIDATION_ERROR" },
        { status: 403 }
      );
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
