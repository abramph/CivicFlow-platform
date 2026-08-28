import { withApiErrorHandling } from "@/lib/api-route";
import { getLatestElection, recordElection } from "@/lib/labs/pta/volunteer-hours/elections";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getClientIp } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("buyout");
    const url = new URL(request.url);
    const periodId = url.searchParams.get("periodId");
    if (!periodId) return Response.json({ ok: true, data: null });
    const election = await getLatestElection(organizationId, periodId, adult.householdId);
    return Response.json({ ok: true, data: election });
  });
}

const bodySchema = z.object({
  periodId: z.string().min(1),
  electionType: z.enum(["VOLUNTEER", "FULL_BUYOUT", "PARTIAL_BUYOUT"]),
  hoursElectedMinutes: z.number().int().min(1).max(100_000).optional(),
  acknowledged: z.boolean(),
});

/** POST /api/labs/pta/volunteer-hours/my-household/election — records the
 * family's choice. This is NOT a payment; no hours are credited here (see
 * VH-F for the checkout that actually posts a PURCHASE ledger entry after
 * confirmed payment). */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("buyout");
    const input = await parseJsonBody(request, bodySchema);
    const election = await recordElection(organizationId, input.periodId, adult.householdId, input, {
      userId: session.userId,
      ipAddress: getClientIp(request),
    });
    return Response.json({ ok: true, data: election }, { status: 201 });
  });
}
