import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAuditAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { prisma } from "@/lib/prisma";

/**
 * GET — org-wide audit history for the volunteer-hours feature (spec:
 * "admin audit-history UI"). Every stage of this program (VH-A through
 * VH-L, and feature/pta-family-agreement-buyout's own agreement/acceptance
 * actions) already writes a dotted `pta.volunteer_hours.*` action on every
 * mutating operation via createAuditEvent — this route surfaces that
 * existing trail rather than maintaining a second, feature-specific log.
 * Gated on pta:volunteer-audit:view via requireVolunteerHoursAuditAccess
 * (FA2 §4, rule 5) rather than the ordinary requireVolunteerHoursAccess —
 * this history must remain viewable even after an org turns "requirements"
 * (or any other capability) off, since audit review is often needed
 * precisely because something was just disabled.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAuditAccess("pta:volunteer-audit:view");
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
