import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { prisma } from "@/lib/prisma";

/**
 * GET — org-wide audit history for the volunteer-hours feature (spec:
 * "admin audit-history UI"). Every stage of this program (VH-A through
 * VH-L) already writes a dotted `pta.volunteer_hours.*` action on every
 * mutating operation via createAuditEvent — this route surfaces that
 * existing trail rather than maintaining a second, feature-specific log.
 * Gated on pta:volunteer-audit:view, the permission VH-A/VH-I defined for
 * exactly this purpose but left unwired until now.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-audit:view", "requirements");
    const url = new URL(request.url);
    const take = Math.min(500, Math.max(1, Number(url.searchParams.get("take")) || 200));

    const rows = await prisma.auditEvent.findMany({
      where: { organizationId, action: { startsWith: "pta.volunteer_hours." } },
      orderBy: { createdAt: "desc" },
      take,
    });

    return Response.json({ ok: true, data: rows });
  });
}
