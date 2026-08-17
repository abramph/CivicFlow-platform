import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakeManage } from "@/lib/member-intake/forms";
import { createFormFromPreset, listIntakeFormPresets } from "@/lib/member-intake/presets";

const VERTICALS = ["COMMUNITY", "PTA", "UNION", "HOA", "CHURCH"] as const;
const bodySchema = z.object({ vertical: z.enum(VERTICALS) });

export async function GET() {
  return withApiErrorHandling(async () => {
    await requireMemberIntakeManage();
    return Response.json({ ok: true, data: listIntakeFormPresets() });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakeManage();
    const { vertical } = await parseJsonBody(request, bodySchema);
    const form = await createFormFromPreset(organizationId, session.userId, vertical);
    return Response.json({ ok: true, data: form }, { status: 201 });
  });
}
