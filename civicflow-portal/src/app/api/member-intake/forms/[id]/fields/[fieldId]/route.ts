import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { requireMemberIntakeManage, deleteFormField } from "@/lib/member-intake/forms";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; fieldId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 60, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { id, fieldId } = await params;
    await deleteFormField(organizationId, id, fieldId, session.userId);
    return Response.json({ ok: true });
  });
}
