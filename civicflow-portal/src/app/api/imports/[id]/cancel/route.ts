import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { transitionImportBatch } from "@/lib/imports/batch-state-machine";

/**
 * Marks a batch CANCELED. Already-imported rows are never rolled back
 * (Phase 8's "do not discard the batch" spirit extends to cancel too) —
 * this only stops further processing of whatever hasn't happened yet.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await requireRateLimit({ scope: "api:imports:cancel", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("imports:cancel", "throw");
    const { id } = await params;

    const updated = await transitionImportBatch({
      batchId: id,
      organizationId,
      to: "CANCELED",
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });

    return Response.json({ ok: true, data: { status: updated.status } });
  });
}
