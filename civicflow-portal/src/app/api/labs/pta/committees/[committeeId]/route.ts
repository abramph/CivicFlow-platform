import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaCommittee, setPtaCommitteeChair, setPtaCommitteeCoChair } from "@/lib/labs/pta/committees";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:directory:read");
    const { committeeId } = await params;
    const committee = await getPtaCommittee(organizationId, committeeId);
    return Response.json({ ok: true, data: committee });
  });
}

const bodySchema = z.object({ chairAdultId: z.string().nullable().optional(), coChairAdultId: z.string().nullable().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ committeeId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:committees:manage");
    const { committeeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const committee =
      input.chairAdultId !== undefined
        ? await setPtaCommitteeChair(organizationId, committeeId, input.chairAdultId, session.userId, session.userEmail)
        : await setPtaCommitteeCoChair(organizationId, committeeId, input.coChairAdultId ?? null, session.userId, session.userEmail);
    return Response.json({ ok: true, data: committee });
  });
}
