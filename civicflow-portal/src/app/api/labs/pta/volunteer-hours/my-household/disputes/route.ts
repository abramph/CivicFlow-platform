import { withApiErrorHandling } from "@/lib/api-route";
import { createHourDispute, listHouseholdDisputes } from "@/lib/labs/pta/volunteer-hours/disputes";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const disputes = await listHouseholdDisputes(organizationId, adult.householdId);
    return Response.json({ ok: true, data: disputes });
  });
}

const bodySchema = z.object({
  periodId: z.string().min(1),
  description: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const input = await parseJsonBody(request, bodySchema);
    const dispute = await createHourDispute(organizationId, input.periodId, adult.householdId, input.description, session.userId);
    return Response.json({ ok: true, data: dispute }, { status: 201 });
  });
}
