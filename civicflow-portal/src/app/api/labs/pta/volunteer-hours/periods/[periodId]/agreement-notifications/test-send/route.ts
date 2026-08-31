import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { sendTestAgreementNotification } from "@/lib/labs/pta/volunteer-hours/agreements";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const CONFIRM_PHRASE = "SEND TEST";

const bodySchema = z
  .object({
    notificationType: z.enum(["AGREEMENT_AVAILABLE", "AGREEMENT_REMINDER", "AGREEMENT_ACCEPTED_CONFIRMATION", "CONTRACT_OFFER_EXPIRING"]),
    testRecipientEmail: z.string().email(),
    confirmText: z.string().min(1),
  })
  .strict();

/**
 * POST — actually SENDS one of the 4 agreement notification templates to
 * an admin-supplied test address (feature/pta-family-agreement-buyout
 * follow-up, FA3 §5). Split out of the old combined preview/send route so
 * a genuine send has strictly more guards than a render-only preview:
 *
 *  - gated on the "notifications" capability (not "requirements") — with
 *    an org's notifications flag off, this fails closed even if
 *    requirements is on, via requireVolunteerHoursAccess's own layered
 *    flag check.
 *  - a dedicated PTA_VOLUNTEER_NOTIFICATIONS_MANAGE permission, distinct
 *    from PTA_VOLUNTEER_REQUIREMENTS_MANAGE (which is enough to preview a
 *    template but not enough, alone, to trigger a real send).
 *  - rate-limited per caller IP, same requireRateLimit helper and
 *    before-auth ordering used by the household-adult invite route.
 *  - a typed confirmation phrase (mirrors /api/account/delete's
 *    "type DELETE to confirm" pattern) so this can't fire from a single
 *    accidental click or an auto-filled/replayed form.
 *  - the recipient is always exactly what the caller typed in THIS
 *    request — no household is ever looked up, so there is no path from
 *    this route to a real family's contact details.
 *
 * CSRF: this route carries no bespoke CSRF token because none exists
 * anywhere else in this app — it relies on the same baseline every other
 * authenticated POST route here does (NextAuth's SameSite=Lax session
 * cookie, which browsers withhold from cross-site POSTs, plus the
 * required `application/json` body that a plain cross-site HTML form
 * cannot send). The typed confirmation phrase is an additional guard
 * against an accidental or replayed submission, not a CSRF token.
 */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  const rateLimited = await requireRateLimit({
    scope: "api:labs:pta:volunteer-hours:agreement-notifications:test-send",
    request,
    limit: 5,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_NOTIFICATIONS_MANAGE, "notifications");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);

    if (input.confirmText.trim().toUpperCase() !== CONFIRM_PHRASE) {
      throw new ValidationError(`Type "${CONFIRM_PHRASE}" to confirm.`);
    }

    await sendTestAgreementNotification(organizationId, periodId, input.notificationType, input.testRecipientEmail, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
