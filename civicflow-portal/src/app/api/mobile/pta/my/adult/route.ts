import { withApiErrorHandling } from "@/lib/api-route";
import { updateOwnPtaHouseholdAdult } from "@/lib/labs/pta/households";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

const updateSelfSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.union([z.string().trim().email().max(254), z.null()]).optional(),
  phone: z.union([z.string().trim().min(3).max(30), z.null()]).optional(),
  relationshipLabel: z.union([z.string().trim().min(1).max(60), z.null()]).optional(),
});

/**
 * PATCH /api/mobile/pta/my/adult?organizationId=...
 *
 * Build 27 parent self-service — the caller updates their OWN
 * PtaHouseholdAdult contact row, and only that row: the adult id comes from
 * the bearer token's linkage (requireMobilePtaHouseholdAccess), never from
 * the request, so there is no way to address another adult. Contact info is
 * the caller's own data — directly editable, no review queue — while
 * identity/roster/placement changes go through change requests.
 */
export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const organizationId = organizationIdFromQuery(request);
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:my:adult:write", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId: verifiedOrgId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const input = await parseJsonBody(request, updateSelfSchema);

    const updated = await updateOwnPtaHouseholdAdult({
      organizationId: verifiedOrgId,
      adultId: adult.id,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.email,
    });

    return Response.json({
      ok: true,
      data: { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, relationshipLabel: updated.relationshipLabel },
    });
  });
}
