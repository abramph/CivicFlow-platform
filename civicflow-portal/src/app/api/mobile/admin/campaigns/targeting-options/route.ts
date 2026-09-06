import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/admin/campaigns/targeting-options?organizationId=...
 *
 * Build 27 — the minimal facts the mobile composer needs to offer the
 * audience selections the backend already supports: whether this is a PTA
 * org (unlocking the pta_target selector) and the current school year (the
 * "unpaid" rule's required parameter). Grade/classroom/committee/event
 * targeting stays web-only until those entity lists have mobile admin
 * endpoints of their own — this route deliberately returns no entity lists.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }

    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { primaryVertical: true } });
    const isPta = organization?.primaryVertical === "PTA";
    const profile = isPta ? await getPtaProfile(organizationId) : null;

    return Response.json({
      ok: true,
      data: { isPta, currentSchoolYear: profile?.currentSchoolYear ?? null },
    });
  });
}
