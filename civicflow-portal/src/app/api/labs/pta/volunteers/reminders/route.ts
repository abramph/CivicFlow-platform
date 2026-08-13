import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { sendVolunteerRemindersForOrganization } from "@/lib/labs/pta/volunteer-reminders";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({ windowHours: z.number().int().min(1).max(168).optional() });

/** POST /api/labs/pta/volunteers/reminders — officer "send reminders now"
 * for shifts starting in the window (default 48h). reminderSentAt dedup
 * makes this safe alongside the cron sweep. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:volunteers:manage");
    const input = await parseJsonBody(request, bodySchema);
    const result = await sendVolunteerRemindersForOrganization(organizationId, {
      windowHours: input.windowHours,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
