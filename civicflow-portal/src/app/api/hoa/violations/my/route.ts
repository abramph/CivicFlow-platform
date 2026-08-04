import { withApiErrorHandling } from "@/lib/api-route";
import { listMyResidentPropertyIds } from "@/lib/hoa/violations-guard";
import { toResidentSafeViolation } from "@/lib/hoa/violations";
import { prisma } from "@/lib/prisma";

/**
 * Resident self-service: every non-DRAFT violation on a property the
 * caller is an ACTIVE resident/owner of, in the active organization.
 * Deliberately excludes DRAFT (an officer's internal working state — see
 * requireHoaViolationResidentAccess's identical exclusion) and every
 * board-only field (resolutionNotes, private comments) via
 * toResidentSafeViolation.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }

    const { propertyIds } = await listMyResidentPropertyIds(organizationId);
    if (propertyIds.length === 0) {
      return Response.json({ ok: true, data: [] });
    }

    const violations = await prisma.violation.findMany({
      where: { organizationId, propertyId: { in: propertyIds }, status: { not: "DRAFT" } },
      include: { notices: { orderBy: { sentAt: "desc" } }, comments: { orderBy: { createdAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({ ok: true, data: violations.map(toResidentSafeViolation) });
  });
}
