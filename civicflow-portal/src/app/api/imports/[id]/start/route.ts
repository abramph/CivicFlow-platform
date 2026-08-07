import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { applyDefaultDecisions, executeBatch } from "@/lib/imports/engine";
import { transitionImportBatch } from "@/lib/imports/batch-state-machine";
import { ImportError } from "@/lib/imports/errors";
import { authorizeImportKind } from "@/lib/imports/authorization";

/**
 * Moves a READY_FOR_REVIEW batch into IMPORTING. Any row still undecided
 * gets the spec's safe default (NEW -> IMPORT_NEW, everything else ->
 * REVIEW_REQUIRED/SKIP — see applyDefaultDecisions()) rather than being
 * silently imported or silently dropped.
 *
 * Re-verifies the domain-specific permission for the batch's actual
 * importKind (authorizeImportKind) before executing anything — a security
 * review of PR C found this route previously only checked the generic
 * imports:create permission, meaning a caller holding imports:create without
 * (say) pta:households:manage could still trigger real PTA/HOA writes here,
 * bypassing the dual-gate POST /api/imports enforces at creation time.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await requireRateLimit({ scope: "api:imports:start", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("imports:create", "throw");
    const { id } = await params;

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    await authorizeImportKind(batch.importKind, organizationId, can);
    if (batch.status !== "READY_FOR_REVIEW") {
      throw new ImportError("IMPORT_BATCH_NOT_RESUMABLE", `This batch is ${batch.status} and cannot be started from here.`);
    }

    await applyDefaultDecisions(id);
    await transitionImportBatch({ batchId: id, organizationId, to: "IMPORTING", actorUserId: session.userId, actorEmail: session.userEmail });
    await executeBatch(id, organizationId, { userId: session.userId, email: session.userEmail });

    const updated = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    return Response.json({ ok: true, data: { status: updated?.status } });
  });
}
