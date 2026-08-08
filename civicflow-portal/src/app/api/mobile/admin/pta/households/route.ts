import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdsPermission } from "@/lib/mobile-admin-pta";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { createPtaHousehold, listPtaHouseholds } from "@/lib/labs/pta/households";

const createHouseholdSchema = z.object({
  organizationId: z.string().min(1),
  displayName: z.string().min(1),
  schoolYear: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE", "PENDING"]).optional(),
  volunteerInterests: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/mobile/admin/pta/households?organizationId=...&schoolYear=...&status=...&search=...
 *
 * Mobile Admin program (PR E) — PTA household roster list. Reuses
 * listPtaHouseholds() (src/lib/labs/pta/households.ts) verbatim, the same
 * function the web /labs/pta/households page uses, so filter/search
 * semantics can never drift between web and mobile.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_DIRECTORY_READ);

    const households = await listPtaHouseholds(organizationId, {
      schoolYear: searchParams.get("schoolYear") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });

    return Response.json({ ok: true, data: households });
  });
}

/**
 * POST /api/mobile/admin/pta/households
 * Delegates to the exact same createPtaHousehold() the web
 * /labs/pta/households/new form uses — no separate mobile-only write path.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:pta:households:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createHouseholdSchema);
    const { userId, email } = await requireMobilePtaHouseholdsPermission(request, organizationId, PERMISSIONS.PTA_HOUSEHOLDS_MANAGE);

    const household = await createPtaHousehold({ organizationId, ...input, actorUserId: userId, actorEmail: email });

    return Response.json({ ok: true, data: household }, { status: 201 });
  });
}
