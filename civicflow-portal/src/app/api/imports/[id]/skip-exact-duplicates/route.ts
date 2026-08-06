import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ImportError } from "@/lib/imports/errors";

/**
 * Bulk skip for EXACT_DUPLICATE rows only (Phase 11's specific bulk-action
 * ask — "Allow bulk actions for exact duplicates," not a general bulk
 * framework). Deliberately does NOT extend to POSSIBLE_DUPLICATE rows — the
 * spec explicitly warns against broad bulk actions on ambiguous matches.
 * Only requires imports:review since SKIP never needs the higher
 * imports:resolve-duplicates tier (same rule as the single-row decide
 * route).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await requireRateLimit({ scope: "api:imports:bulk-decide", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("imports:review", "throw");
    const { id } = await params;

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    if (batch.status !== "READY_FOR_REVIEW") {
      throw new ImportError(
        "IMPORT_STALE_DECISION",
        `This batch is ${batch.status} — decisions can only be recorded while it's ready for review.`
      );
    }

    const result = await prisma.importRow.updateMany({
      where: { batchId: id, organizationId, status: "EXACT_DUPLICATE" },
      data: { decision: "SKIP", decidedByUserId: session.userId, decidedAt: new Date() },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "import_row.bulk_skip_exact_duplicates",
      entityType: "import_batch",
      entityId: id,
      metadata: { count: result.count },
    });

    return Response.json({ ok: true, data: { skippedCount: result.count } });
  });
}
