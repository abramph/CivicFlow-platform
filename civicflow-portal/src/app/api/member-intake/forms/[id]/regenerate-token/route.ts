import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { requireMemberIntakePublish, regenerateIntakeFormToken } from "@/lib/member-intake/forms";
import { getServerEnv } from "@/lib/env";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakePublish();
    const { id } = await params;
    const form = await regenerateIntakeFormToken(organizationId, id, session.userId);
    const publicUrl = `${getServerEnv().NEXTAUTH_URL.replace(/\/+$/, "")}/f/${form.publicToken}`;
    return Response.json({ ok: true, data: { ...form, publicUrl } });
  });
}
