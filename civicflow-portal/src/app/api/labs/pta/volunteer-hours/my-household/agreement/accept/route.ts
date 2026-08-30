import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { acceptAgreement } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const acceptSchema = z
  .object({
    periodId: z.string().min(1).optional(),
    acknowledged: z.boolean(),
    typedName: z.string().max(200).optional(),
  })
  .strict();

/**
 * POST — the ONE mutation this whole feature's family flow performs before
 * any election exists. `acceptedByAdultId`/`acceptedByUserId` are both
 * resolved server-side from the authenticated session (never
 * client-supplied) — a caller cannot accept for another household, and
 * cannot submit an organizationId/householdId/periodId/agreementVersionId
 * outside their own authenticated context, since none of those are ever
 * read from the request body except the period (and even that is only used
 * to look up the period's OWN assigned version — see acceptAgreement).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const input = await parseJsonBody(request, acceptSchema);
    let periodId = input.periodId;
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) return Response.json({ ok: false, error: "No active volunteer requirement period." }, { status: 404 });
      periodId = current.id;
    }
    const acceptance = await acceptAgreement(
      organizationId,
      periodId,
      adult.householdId,
      { acknowledged: input.acknowledged, typedName: input.typedName ?? null },
      { userId: session.userId, adultId: adult.id }
    );
    return Response.json({ ok: true, data: acceptance }, { status: 201 });
  });
}
