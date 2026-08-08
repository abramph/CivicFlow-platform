import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { generateDuesForMember, generateDuesForMemberSchema } from "@/lib/dues-generate-member";

const bodySchema = generateDuesForMemberSchema.extend({ organizationId: z.string().min(1) });

/**
 * POST /api/mobile/admin/dues/generate
 * Member-scoped only -- deliberately does not expose whole-organization
 * bulk generation on mobile (see generateDuesForMember's doc comment).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:dues:generate",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, bodySchema);
    const { userId, email } = await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_WRITE);

    const result = await generateDuesForMember(organizationId, { userId, userEmail: email }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
