import { withApiErrorHandling } from "@/lib/api-route";
import { createVolunteerAssessmentCheckout } from "@/lib/labs/pta/volunteer-hours/assessment-payments";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ coverProcessingCosts: z.boolean().optional() });

export async function POST(request: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:pta-volunteer-hours:assessment-checkout", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("assessments");
    const { chargeId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await createVolunteerAssessmentCheckout(organizationId, chargeId, adult.householdId, { userId: session.userId }, input);
    return Response.json({ ok: true, url: result.url });
  });
}
