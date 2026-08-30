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

// FC-6: see the matching comment in ../route.ts — zone-less wall-clock date
// strings, resolved server-side against the period's own timezone.
const wallDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");
const bodySchema = z.object({
  name: z.string().min(1).max(120),
  periodType: z.enum(["SCHOOL_YEAR", "TERM", "CALENDAR_YEAR", "MEMBERSHIP_YEAR", "CONTRACT_PERIOD", "CUSTOM"]),
  startsOn: wallDate,
  endsOn: wallDate,
  requiredMinutesDefault: z.number().int().min(0).max(100_000),
  volunteerDeadline: wallDate.nullable().optional(),
  buyoutWindowStart: wallDate.nullable().optional(),
  buyoutWindowEnd: wallDate.nullable().optional(),
  assessmentDate: wallDate.nullable().optional(),
  assessmentPaymentDueDate: wallDate.nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
  adminNotes: z.string().max(4000).nullable().optional(),
  familyPolicyText: z.string().max(20_000).nullable().optional(),
  scopeLabel: z.string().max(120).nullable().optional(),
  // RV-4: see the matching comment in ../route.ts. An omitted key here
  // means "leave unchanged" (periods.ts: resolveBuyoutField) — never
  // "reset to default" — which only matters for a non-UI caller, since the
  // admin UI always resubmits every field on every save.
  buyoutFullAllowed: z.boolean().optional(),
  buyoutMinPurchaseMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutMaxPurchaseMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutMinServiceMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutIncrementMinutes: z.number().int().min(1).max(1_440).optional(),
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
