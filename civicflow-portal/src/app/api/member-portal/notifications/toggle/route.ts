import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
});

/**
 * Flips the day-to-day SMS notifications preference. Only allowed once real
 * consent (smsOptIn) is on file — this is not how consent is granted or
 * withdrawn, just paused/resumed.
 */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, enabled } = await parseJsonBody(request, bodySchema);
    const { memberId } = await requireMemberWebSession(organizationId);

    const member = await prisma.orgMember.findUnique({ where: { id: memberId }, select: { smsOptIn: true } });
    if (!member?.smsOptIn) {
      return Response.json(
        { ok: false, error: "You haven't opted in to SMS yet. Verify your phone number first." },
        { status: 400 }
      );
    }

    await prisma.orgMember.update({ where: { id: memberId }, data: { commsSmsEnabled: enabled } });

    return Response.json({ ok: true });
  });
}
