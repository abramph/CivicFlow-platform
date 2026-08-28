import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { previewVolunteerHoursNotification } from "@/lib/labs/pta/volunteer-hours/notifications";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  notificationType: z.enum(["DEADLINE_REMINDER", "ASSESSMENT_POSTED", "RATE_CHANGE_UPCOMING"]),
  testRecipientEmail: z.string().email(),
});

/**
 * POST — admin preview/test-send (spec: "admins can preview/test-send to
 * approved test recipients only"). Deliberately gated on the "requirements"
 * capability, not "notifications" — an admin must be able to preview these
 * templates before ever turning the automated-send flag on. Never looks up
 * a real household's email; the recipient is always supplied directly in
 * the request body by the calling officer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    await previewVolunteerHoursNotification(organizationId, periodId, input.notificationType, input.testRecipientEmail, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true });
  });
}
