import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { sendVolunteerHoursRateChangeNotices } from "@/lib/labs/pta/volunteer-hours/notifications";

/** POST — officer "send rate-change notices now" for this period. */
export async function POST(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "notifications");
    const { periodId } = await params;
    const result = await sendVolunteerHoursRateChangeNotices(organizationId, periodId, {
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
