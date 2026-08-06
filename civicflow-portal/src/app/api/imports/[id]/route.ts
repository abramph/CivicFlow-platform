import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { ImportError } from "@/lib/imports/errors";
import { attachFieldComparisons } from "@/lib/imports/duplicate-matching";

const ROW_PAGE_SIZE = 100;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("imports:read", "throw");
    const { id } = await params;

    const batch = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    if (!batch) {
      throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found.");
    }

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
    // OrgMember on every read, never persisted, so it always reflects the
    // current state of the matched record even if it changed after
    // analysis. Batched into a single query rather than one per row.
    const rowsWithComparison = await attachFieldComparisons(rows, organizationId);

    return Response.json({
      ok: true,
      data: {
        batch,
        rows: rowsWithComparison,
        nextCursor: rows.length === ROW_PAGE_SIZE ? rows[rows.length - 1].id : null,
      },
    });
  });
}
