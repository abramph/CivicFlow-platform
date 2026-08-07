import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { resumeBatch } from "@/lib/imports/engine";
import { ImportError } from "@/lib/imports/errors";
import { authorizeImportKind } from "@/lib/imports/authorization";

/**
 * Re-verifies the domain-specific permission for the batch's actual
 * importKind (authorizeImportKind) before resuming — same reasoning as
 * start/route.ts: imports:resume alone isn't enough once a batch's kind
 * needs a real household/property write, only generic capacity to resume
 * ANY batch.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await requireRateLimit({ scope: "api:imports:resume", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("imports:resume", "throw");
    const { id } = await params;

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    await authorizeImportKind(batch.importKind, organizationId, can);

    await resumeBatch(id, organizationId, session.userId, { userId: session.userId, email: session.userEmail });

    const updated = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    return Response.json({ ok: true, data: { status: updated?.status } });
  });
}
