import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileHoaPermission } from "@/lib/mobile-admin-hoa";
import { requireRateLimit } from "@/lib/rate-limit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { PERMISSIONS } from "@/lib/rbac";
import { createViolationDraft, listViolations } from "@/lib/hoa/violations";

const VIOLATION_STATUSES = ["DRAFT", "ISSUED", "ACKNOWLEDGED", "IN_REVIEW", "CURED", "RESOLVED", "DISMISSED"] as const;

const createViolationSchema = z.object({
  organizationId: z.string().min(1),
  propertyId: z.string().min(1),
  violationType: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  cureByDate: z.coerce.date().nullable().optional(),
});

/**
 * GET /api/mobile/admin/hoa/violations?organizationId=...&propertyId=...&status=...
 *
 * Mobile Admin program (PR E) — HOA violation list. Reuses listViolations()
 * (src/lib/hoa/violations.ts) verbatim.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_READ);

    const statusParam = searchParams.get("status");
    const status = VIOLATION_STATUSES.includes(statusParam as (typeof VIOLATION_STATUSES)[number])
      ? (statusParam as (typeof VIOLATION_STATUSES)[number])
      : undefined;

    const violations = await listViolations(organizationId, {
      propertyId: searchParams.get("propertyId") ?? undefined,
      status,
    });

    return Response.json({ ok: true, data: violations });
  });
}

/**
 * POST /api/mobile/admin/hoa/violations
 * Creates a DRAFT violation — delegates to createViolationDraft(), the
 * exact function the web /hoa/violations/new form uses.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:hoa:violations:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createViolationSchema);
    const { userId } = await requireMobileHoaPermission(request, organizationId, "manageHoaViolations", PERMISSIONS.HOA_VIOLATIONS_WRITE);

    const violation = await createViolationDraft({ organizationId, ...input, actorUserId: userId });
    return Response.json({ ok: true, data: violation }, { status: 201 });
  });
}
