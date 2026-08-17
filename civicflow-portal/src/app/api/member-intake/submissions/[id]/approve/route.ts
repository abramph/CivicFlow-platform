import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { requireMemberIntakeReview } from "@/lib/member-intake/forms";
import { approveSubmission } from "@/lib/member-intake/review";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:submissions:review", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeReview();
    const { id } = await params;
    const result = await approveSubmission(organizationId, id, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: result });
  });
}
