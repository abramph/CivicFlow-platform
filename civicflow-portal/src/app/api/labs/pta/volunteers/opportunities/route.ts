import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { requireOrganizationLabFeature } from "@/lib/labs/access";
import { requireOrganization } from "@/lib/auth-guards";
import { createPtaVolunteerOpportunity, listPtaVolunteerOpportunities } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

/** Any organization member (including a plain parent, MEMBER role) can browse open opportunities — read access here is intentionally NOT gated by pta:volunteers:manage, only by Labs enrollment + an active session. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireOrganization();
    await requireOrganizationLabFeature(organizationId, "ptaVertical");
    const opportunities = await listPtaVolunteerOpportunities(organizationId);
    return Response.json({ ok: true, data: opportunities });
  });
}

const createSchema = z.object({
  title: z.string().min(1),
  eventId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
  signupDeadline: z.coerce.date().nullable().optional(),
  supplyRequest: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const input = await parseJsonBody(request, createSchema);
    const opportunity = await createPtaVolunteerOpportunity({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, ...input });
    return Response.json({ ok: true, data: opportunity });
  });
}
