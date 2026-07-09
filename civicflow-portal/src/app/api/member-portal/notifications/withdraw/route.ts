import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { getClientIp } from "@/lib/rate-limit";
import { recordSmsOptOut } from "@/lib/sms-consent";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
});

/** Fully withdraws SMS consent. Turning SMS back on later requires re-verifying the phone number. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await parseJsonBody(request, bodySchema);
    const { userId, memberId } = await requireMemberWebSession(organizationId);

    await recordSmsOptOut({
      organizationId,
      memberId,
      actorUserId: userId,
      source: "self_service",
      ip: getClientIp(request),
    });

    return Response.json({ ok: true });
  });
}
