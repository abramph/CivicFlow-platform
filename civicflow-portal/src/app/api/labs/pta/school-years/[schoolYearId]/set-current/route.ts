import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { setCurrentSchoolYear } from "@/lib/labs/pta/school-years";

/** POST /api/labs/pta/school-years/:id/set-current — flips the active year
 * (and the PtaProfile label with it, transactionally). */
export async function POST(_request: Request, { params }: { params: Promise<{ schoolYearId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:school-years:manage");
    const { schoolYearId } = await params;
    const year = await setCurrentSchoolYear({
      organizationId,
      schoolYearId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: year });
  });
}
