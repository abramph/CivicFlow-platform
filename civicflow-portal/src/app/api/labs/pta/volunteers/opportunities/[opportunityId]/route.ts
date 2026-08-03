import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { getPtaVolunteerOpportunity, updatePtaVolunteerOpportunity } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const opportunity = await getPtaVolunteerOpportunity(organizationId, opportunityId);
    return Response.json({ ok: true, data: opportunity });
  });
}

const bodySchema = z.object({
  title: z.string().min(1).optional(),
  eventId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  coordinatorUserId: z.string().nullable().optional(),
  committeeId: z.string().nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  signupDeadline: z.coerce.date().nullable().optional(),
  cancellationDeadline: z.coerce.date().nullable().optional(),
  supplyRequest: z.string().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ opportunityId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { opportunityId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const opportunity = await updatePtaVolunteerOpportunity(organizationId, opportunityId, input, session.userId, session.userEmail);
    return Response.json({ ok: true, data: opportunity });
  });
}
