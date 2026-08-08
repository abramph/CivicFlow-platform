import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { addPtaHouseholdAdult } from "@/lib/labs/pta/households";

const addAdultSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  relationshipLabel: z.string().nullable().optional(),
  makePrimaryContact: z.boolean().optional(),
});

type RouteParams = { params: Promise<{ householdId: string }> };

/**
 * POST /api/mobile/admin/pta/households/[householdId]/adults
 * No userId field is accepted — matches the web form exactly. Linking an
 * adult to a user account has no built officer workflow anywhere in this
 * codebase yet (web or mobile); this is pure roster data entry.
 */
export async function POST(request: Request, { params }: RouteParams) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { householdId } = await params;
    const { organizationId, ...input } = await parseJsonBody(request, addAdultSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const adult = await addPtaHouseholdAdult({ organizationId, householdId, ...input, actorUserId: userId, actorEmail: email });
    return Response.json({ ok: true, data: adult }, { status: 201 });
  });
}
