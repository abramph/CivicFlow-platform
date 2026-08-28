import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { createVolunteerRequirementPeriod, listVolunteerRequirementPeriods } from "@/lib/labs/pta/volunteer-hours/periods";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/labs/pta/volunteer-hours/periods — every requirement period for
 * this org, newest-active-first. Dark unless ptaVolunteerRequirementsEnabled
 * (and the platform kill-switch) are on. */
export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const periods = await listVolunteerRequirementPeriods(organizationId);
    return Response.json({ ok: true, data: periods });
  });
}

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  periodType: z.enum(["SCHOOL_YEAR", "TERM", "CALENDAR_YEAR", "MEMBERSHIP_YEAR", "CONTRACT_PERIOD", "CUSTOM"]),
  startsOn: z.coerce.date(),
  endsOn: z.coerce.date(),
  requiredMinutesDefault: z.number().int().min(0).max(100_000),
  volunteerDeadline: z.coerce.date().nullable().optional(),
  buyoutWindowStart: z.coerce.date().nullable().optional(),
  buyoutWindowEnd: z.coerce.date().nullable().optional(),
  assessmentDate: z.coerce.date().nullable().optional(),
  assessmentPaymentDueDate: z.coerce.date().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
  adminNotes: z.string().max(4000).nullable().optional(),
  familyPolicyText: z.string().max(20_000).nullable().optional(),
  scopeLabel: z.string().max(120).nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const input = await parseJsonBody(request, bodySchema);
    const period = await createVolunteerRequirementPeriod(organizationId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: period }, { status: 201 });
  });
}
