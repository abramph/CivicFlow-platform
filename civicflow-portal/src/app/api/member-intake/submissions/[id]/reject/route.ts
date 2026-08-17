import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeReview } from "@/lib/member-intake/forms";
import { rejectSubmission } from "@/lib/member-intake/review";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:submissions:review", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeReview();
    const { id } = await params;
    const { reason } = await parseJsonBody(request, bodySchema);
    await rejectSubmission(organizationId, id, { userId: session.userId, userEmail: session.userEmail }, reason);
    return Response.json({ ok: true, data: { id } });
  });
}
