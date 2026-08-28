import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getVolunteerRequirementPeriod, updateVolunteerRequirementPeriod } from "@/lib/labs/pta/volunteer-hours/periods";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const period = await getVolunteerRequirementPeriod(organizationId, periodId);
    return Response.json({ ok: true, data: period });
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

export async function PATCH(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:manage", "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const period = await updateVolunteerRequirementPeriod(organizationId, periodId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: period });
  });
}
