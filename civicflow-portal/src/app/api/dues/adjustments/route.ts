import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/validation";
import { createDuesAdjustment, createDuesAdjustmentSchema } from "@/lib/dues-adjustments";

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:dues:adjustments",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createDuesAdjustmentSchema);

    const result = await createDuesAdjustment(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
