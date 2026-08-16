import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeManage, createFormSource } from "@/lib/member-intake/forms";

const bodySchema = z.object({ name: z.string().trim().min(1).max(160) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { id } = await params;
    const { name } = await parseJsonBody(request, bodySchema);

    const source = await createFormSource(organizationId, id, session.userId, name);
    return Response.json({ ok: true, data: source }, { status: 201 });
  });
}
