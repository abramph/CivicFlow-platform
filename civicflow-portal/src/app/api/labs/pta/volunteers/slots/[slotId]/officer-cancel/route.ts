import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { cancelPtaVolunteerSignup } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ householdAdultId: z.string().min(1), reason: z.string().nullable().optional() });

/**
 * Officer-initiated removal/unassignment of a volunteer from a slot —
 * distinct from the self-service .../slots/[slotId]/cancel route (which
 * resolves householdAdultId from the caller's own session and respects the
 * opportunity's cancellationDeadline). This route lets an officer free up
 * a seat from a no-show or a mistaken assignment, including past the
 * deadline, via cancelPtaVolunteerSignup's existing officerOverride flag —
 * that flag has been fully implemented and audited since the function was
 * written, but no route ever passed it as true until now.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { slotId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const signup = await cancelPtaVolunteerSignup(
      organizationId,
      slotId,
      input.householdAdultId,
      session.userId,
      { reason: input.reason ?? null, officerOverride: true },
      session.userEmail
    );
    return Response.json({ ok: true, data: signup });
  });
}
