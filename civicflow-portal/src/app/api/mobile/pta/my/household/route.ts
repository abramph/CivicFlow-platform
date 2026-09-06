import { withApiErrorHandling } from "@/lib/api-route";
import { getPtaProfile } from "@/lib/labs/pta/profile";
import { updateOwnPtaHouseholdVolunteerInterests } from "@/lib/labs/pta/households";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

function organizationIdFromQuery(request: Request): string {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!organizationId) throw new ValidationError("organizationId is required");
  return organizationId;
}

/**
 * GET /api/mobile/pta/my/household?organizationId=...
 *
 * Build 27 — the parent's own family, resolved entirely from the caller's
 * PtaHouseholdAdult linkage (no household id parameter exists to substitute).
 * Returns the roster the Edit Family flow needs: adults (with an isSelf
 * marker so the app knows which row the caller may edit directly), ACTIVE
 * students with photo presence and their current-school-year placement
 * label, and the household's directly-editable preference fields.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationIdFromQuery(request));

    const [household, profile] = await Promise.all([
      prisma.ptaHousehold.findFirst({
        where: { id: adult.householdId, organizationId },
        include: {
          adults: { select: { id: true, name: true, email: true, phone: true, relationshipLabel: true, userId: true } },
          students: { where: { status: "ACTIVE" }, select: { id: true, displayName: true, status: true, photoUrl: true } },
        },
      }),
      getPtaProfile(organizationId),
    ]);
    if (!household) {
      return Response.json({ ok: false, error: "Household not found" }, { status: 404 });
    }

    const currentSchoolYear = profile?.currentSchoolYear ?? null;
    const placements = currentSchoolYear
      ? await prisma.ptaStudentEnrollment.findMany({
          where: { organizationId, schoolYear: currentSchoolYear, studentId: { in: household.students.map((s) => s.id) }, status: "ACTIVE" },
          select: { studentId: true, classroom: { select: { name: true, grade: { select: { name: true } } } } },
        })
      : [];
    const placementByStudentId = new Map(placements.map((p) => [p.studentId, `${p.classroom.grade.name} · ${p.classroom.name}`]));

    return Response.json({
      ok: true,
      data: {
        householdId: household.id,
        displayName: household.displayName,
        schoolYear: household.schoolYear,
        currentSchoolYear,
        volunteerInterests: household.volunteerInterests,
        adults: household.adults.map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          phone: a.phone,
          relationshipLabel: a.relationshipLabel,
          hasLogin: a.userId != null,
          isSelf: a.userId === session.userId,
        })),
        students: household.students.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          status: s.status,
          hasPhoto: s.photoUrl != null,
          placementLabel: placementByStudentId.get(s.id) ?? null,
        })),
      },
    });
  });
}

const updateHouseholdSchema = z.object({
  volunteerInterests: z.array(z.string().trim().min(1).max(80)).max(25),
});

/**
 * PATCH /api/mobile/pta/my/household?organizationId=...
 * Directly-editable household preference data ONLY (volunteer interests).
 * Display name, roster, and placements go through change requests.
 */
export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const organizationId = organizationIdFromQuery(request);
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:my:household:write", request, limit: 20, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId: verifiedOrgId, adult, session } = await requireMobilePtaHouseholdAccess(request, organizationId);
    const input = await parseJsonBody(request, updateHouseholdSchema);

    const updated = await updateOwnPtaHouseholdVolunteerInterests(verifiedOrgId, adult.householdId, input.volunteerInterests, session.userId, session.email);
    return Response.json({ ok: true, data: { volunteerInterests: updated.volunteerInterests } });
  });
}
