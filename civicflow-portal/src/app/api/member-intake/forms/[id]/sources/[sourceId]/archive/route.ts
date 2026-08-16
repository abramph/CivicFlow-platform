import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { requireMemberIntakeManage, archiveFormSource } from "@/lib/member-intake/forms";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { id, sourceId } = await params;
    const source = await archiveFormSource(organizationId, id, sourceId, session.userId);
    return Response.json({ ok: true, data: source });
  });
}
