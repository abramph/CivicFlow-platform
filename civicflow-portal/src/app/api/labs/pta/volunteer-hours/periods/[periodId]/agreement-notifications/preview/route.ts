import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { previewAgreementNotification } from "@/lib/labs/pta/volunteer-hours/agreements";
import { PERMISSIONS } from "@/lib/rbac";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z
  .object({
    notificationType: z.enum(["AGREEMENT_AVAILABLE", "AGREEMENT_REMINDER", "AGREEMENT_ACCEPTED_CONFIRMATION", "CONTRACT_OFFER_EXPIRING"]),
  })
  .strict();

/**
 * POST — renders one of the 4 agreement notification templates. Never
 * sends an email (feature/pta-family-agreement-buyout follow-up, FA3 §5 —
 * previously this route both rendered AND sent to a caller-supplied
 * address; that's now sendTestAgreementNotification's job, gated
 * separately on the "notifications" capability). Deliberately gated on
 * "requirements", not "notifications": an admin must be able to see what
 * these templates say BEFORE ever deciding to enable the notifications
 * flag, so gating preview behind that same flag would be circular.
 */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE, "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const preview = await previewAgreementNotification(organizationId, periodId, input.notificationType, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, preview });
  });
}
