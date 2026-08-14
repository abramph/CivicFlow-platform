import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { createPledge, listMyPledges } from "@/lib/giving/pledges";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

/** CORE-GIVE-E — the member's own pledges with live progress. */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const memberSession = await requireMemberWebSession(searchParams.get("org") ?? "");
    const pledges = await listMyPledges(memberSession.organizationId, memberSession.userId);
    return Response.json({ ok: true, data: pledges });
  });
}

const createSchema = z.object({
  organizationId: z.string().min(1),
  fundId: z.string().min(1).max(64),
  pledgedAmount: z.number().positive().max(10_000_000),
  campaignId: z.string().max(64).nullable().optional(),
  targetCompletionDate: z.coerce.date().nullable().optional(),
  allowPublicRecognition: z.boolean().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** POST — member states their own pledge on a pledge-enabled fund. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:giving:pledge-create", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, createSchema);
    const memberSession = await requireMemberWebSession(input.organizationId);
    const pledge = await createPledge({
      organizationId: memberSession.organizationId,
      contributorUserId: memberSession.userId,
      memberId: memberSession.memberId,
      fundId: input.fundId,
      pledgedAmount: input.pledgedAmount,
      campaignId: input.campaignId ?? null,
      targetCompletionDate: input.targetCompletionDate ?? null,
      allowPublicRecognition: input.allowPublicRecognition ?? false,
      notes: input.notes ?? null,
      actorUserId: memberSession.userId,
    });
    return Response.json({ ok: true, data: pledge }, { status: 201 });
  });
}
