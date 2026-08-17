import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeReview } from "@/lib/member-intake/forms";
import { linkSubmissionToMember } from "@/lib/member-intake/review";

const bodySchema = z.object({ memberId: z.string().trim().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:submissions:review", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeReview();
    const { id } = await params;
    const { memberId } = await parseJsonBody(request, bodySchema);
    const result = await linkSubmissionToMember(organizationId, id, memberId, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
