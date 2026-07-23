import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { completePtaVolunteerSignup } from "@/lib/labs/pta/volunteers";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ hoursLogged: z.number().min(0).nullable().optional() });

/** Officer-only — a parent cannot mark their own signup completed or set hours (see task's explicit requirement that volunteer-hour recording cannot be altered by unauthorized parents). */
export async function POST(request: Request, { params }: { params: Promise<{ signupId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const { signupId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const signup = await completePtaVolunteerSignup(organizationId, signupId, input.hoursLogged ?? null, session.userId, session.userEmail);
    return Response.json({ ok: true, data: signup });
  });
}
