import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { ImportError } from "@/lib/imports/errors";
import { attachFieldComparisons } from "@/lib/imports/duplicate-matching";
import { formatRowIdentity } from "@/lib/imports/row-normalization";
import { authorizeImportKindRead } from "@/lib/imports/authorization";

const ROW_PAGE_SIZE = 100;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, can } = await requirePermission("imports:read", "throw");
    const { id } = await params;

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) {
      throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    }
    authorizeImportKindRead(batch.importKind, can);

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");
    const cursor = url.searchParams.get("cursor");

    const rows = await prisma.importRow.findMany({
      where: { batchId: id, ...(statusFilter ? { status: statusFilter as never } : {}) },
      orderBy: { rowNumber: "asc" },
      take: ROW_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    // Matched-record comparison (Phase 11) — computed fresh from the live
    // matched record on every read, never persisted, so it always reflects
    // the current state of the matched record even if it changed after
    // analysis. Batched into a single query rather than one per row.
    // Dispatches by importKind (PR C) since the matched model varies.
    const rowsWithComparison = await attachFieldComparisons(rows, organizationId, batch.importKind);
    const rowsWithIdentity = rowsWithComparison.map((row) => ({ ...row, ...formatRowIdentity(batch.importKind, row.normalizedData) }));

    return Response.json({
      ok: true,
      data: {
        batch,
        rows: rowsWithIdentity,
        nextCursor: rows.length === ROW_PAGE_SIZE ? rows[rows.length - 1].id : null,
      },
    });
  });
}
