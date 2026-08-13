import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { seedStandardPositions } from "@/lib/labs/pta/board";

/** POST /api/labs/pta/board/positions/seed-standard — one-click creation of
 * the common PTA titles (idempotent; existing names untouched). */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:board:manage");
    const result = await seedStandardPositions({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: { created: result.count } });
  });
}
