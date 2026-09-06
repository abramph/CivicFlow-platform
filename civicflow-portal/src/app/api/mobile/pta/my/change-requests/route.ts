import { withApiErrorHandling } from "@/lib/api-route";
import { listFamilyChangeRequestsForHousehold, submitFamilyChangeRequest } from "@/lib/labs/pta/family-change-requests";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

/**
 * Build 27 — a parent's own household change requests. The household is
 * always the caller's own (linkage-resolved); the payload is validated and
 * reference-checked by the service, and the type vocabulary is the closed
 * PtaFamilyChangeRequestType enum.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));
    const rows = await listFamilyChangeRequestsForHousehold(organizationId, adult.householdId);
    return Response.json({
      ok: true,
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        status: row.status,
        decisionNotes: row.decisionNotes,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        appliedAt: row.appliedAt,
      })),
    });
  });
}

const submitSchema = z.object({
  type: z.enum(["HOUSEHOLD_DISPLAY_NAME", "ADD_STUDENT", "RENAME_STUDENT", "STUDENT_PLACEMENT", "REMOVE_STUDENT"]),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const organizationId = organizationIdFromQuery(request);
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:my:change-requests:write", request, limit: 15, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId: verifiedOrgId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const input = await parseJsonBody(request, submitSchema);

    const created = await submitFamilyChangeRequest({
      organizationId: verifiedOrgId,
      householdId: adult.householdId,
      submittedByAdultId: adult.id,
      type: input.type,
      payload: input.payload,
      actorUserId: session.userId,
      actorEmail: session.email,
    });

    return Response.json(
      { ok: true, data: { id: created.id, type: created.type, status: created.status, createdAt: created.createdAt } },
      { status: 201 }
    );
  });
}
