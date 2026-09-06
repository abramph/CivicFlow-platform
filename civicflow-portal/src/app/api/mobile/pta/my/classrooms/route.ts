import { withApiErrorHandling } from "@/lib/api-route";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

/**
 * GET /api/mobile/pta/my/classrooms?organizationId=...
 *
 * Build 27 — the current school year's classroom list for a parent filing a
 * placement change request. Names and grades only: no teacher contact
 * details, no rosters, no counts — a parent picking "3rd Grade · Room 12"
 * needs exactly the label, nothing about who else is in it.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));

    const profile = await getPtaProfile(organizationId);
    if (!profile?.currentSchoolYear) {
      return Response.json({ ok: true, data: { currentSchoolYear: null, classrooms: [] } });
    }

    const classrooms = await prisma.ptaClassroom.findMany({
      where: { organizationId, schoolYear: profile.currentSchoolYear },
      select: { id: true, name: true, grade: { select: { name: true, sortOrder: true } } },
      orderBy: [{ grade: { sortOrder: "asc" } }, { name: "asc" }],
    });

    return Response.json({
      ok: true,
      data: {
        currentSchoolYear: profile.currentSchoolYear,
        classrooms: classrooms.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade.name })),
      },
    });
  });
}
