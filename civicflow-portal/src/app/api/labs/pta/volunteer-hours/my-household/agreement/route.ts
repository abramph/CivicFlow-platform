import { withApiErrorHandling } from "@/lib/api-route";
import { checkVolunteerHoursAvailable, requireVolunteerHoursHouseholdAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getCurrentActivePeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { resolveHouseholdAgreementStatus } from "@/lib/labs/pta/volunteer-hours/agreements";

/** GET — a family's own agreement status for the current (or specified)
 * period: whether required, the assigned version's full text (so the
 * family can read it before accepting), whether/when they accepted, and
 * their contract-linked offer window if applicable. Never accepts a
 * client-supplied householdId — resolved server-side from the
 * authenticated adult's own household, same pattern as every other
 * my-household route in this program.
 *
 * FA2 §4 (capability-guard rule 2/3): gated only on "requirements" — never
 * "buyout" — so a family can always view an agreement it already accepted,
 * or accept a volunteer-only agreement, even when this org's buyout
 * capability is disabled (rule 3). The three contract-linked-buyout fields
 * ARE, however, "contract-linked buyout terms" in their own right (rule 2)
 * — reported here as inert defaults when the buyout capability itself is
 * off, so this response can never promise an offer the household would
 * then be denied when trying to act on it via the (separately, buyout-
 * capability-gated) election routes.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireVolunteerHoursHouseholdAccess("requirements");
    const url = new URL(request.url);
    let periodId = url.searchParams.get("periodId");
    if (!periodId) {
      const current = await getCurrentActivePeriod(organizationId);
      if (!current) return Response.json({ ok: true, data: null });
      periodId = current.id;
    }
    const [status, buyoutAvailable] = await Promise.all([
      resolveHouseholdAgreementStatus(organizationId, periodId, adult.householdId),
      checkVolunteerHoursAvailable(organizationId, "buyout"),
    ]);
    const data = buyoutAvailable
      ? { ...status, periodId }
      : { ...status, periodId, contractLinkedBuyoutEnabled: false, contractLinkedEligibleUntil: null, contractLinkedEligibleNow: false };
    return Response.json({ ok: true, data });
  });
}
