import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { previewAgreementNotification } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z
  .object({
    notificationType: z.enum(["AGREEMENT_AVAILABLE", "AGREEMENT_REMINDER", "AGREEMENT_ACCEPTED_CONFIRMATION", "CONTRACT_OFFER_EXPIRING"]),
    testRecipientEmail: z.string().email(),
  })
  .strict();

/**
 * POST — admin preview/test-send for the 4 agreement notification templates
 * (feature/pta-family-agreement-buyout, FA-8's previewAgreementNotification,
 * left unwired to any route until this follow-up — see FA2 §10).
 * Deliberately gated on "requirements" — mirroring the sibling
 * .../notifications/preview/route.ts's own established, documented
 * decision — not "notifications": an admin must be able to preview what
 * these templates say BEFORE ever deciding to enable the notifications
 * flag, so gating preview behind that same flag would be circular. A REAL
 * automated sweep (not built this round — see docs) is what FA2 §4's rule
 * "notifications require the notifications flag plus the relevant
 * capability" governs; this preview path only ever sends to an
 * admin-supplied test address (never a real household) and is separately,
 * atomically audited by previewAgreementNotification itself.
 */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    await previewAgreementNotification(organizationId, periodId, input.notificationType, input.testRecipientEmail, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
