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

// FC-6: these are zone-less wall-clock date strings ("YYYY-MM-DD") exactly
// as `<input type="date">` produces — the server resolves them against the
// organization's timezone (resolveOrgWallTimeToUtc), never `z.coerce.date()`,
// which would silently treat them as UTC midnight regardless of the org's
// actual timezone. See docs/pta-volunteer-hours-pricing-lock-design.md's
// sibling FC-6 correction and src/lib/labs/pta/volunteer-hours/timezone.ts.
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
  // RV-4: buyout policy limits — periods.ts's validateBuyoutPolicy does the
  // real cross-field validation (min<=max, multiple-of-increment, etc.);
  // this schema only enforces basic shape so a malformed request never
  // reaches the service layer at all.
  buyoutFullAllowed: z.boolean().optional(),
  buyoutMinPurchaseMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutMaxPurchaseMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutMinServiceMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  buyoutIncrementMinutes: z.number().int().min(1).max(1_440).optional(),
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
