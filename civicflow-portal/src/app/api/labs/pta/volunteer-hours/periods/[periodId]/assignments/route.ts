import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createAssignment, listPeriodAssignments } from "@/lib/labs/pta/volunteer-hours/assignments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const assignments = await listPeriodAssignments(organizationId, periodId);
    return Response.json({ ok: true, data: assignments });
  });
}

const bodySchema = z.object({
  scopeType: z.enum(["ALL", "MEMBERSHIP_PLAN", "GRADE", "CLASSROOM", "PROGRAM", "HOUSEHOLD"]),
  scopeRefId: z.string().min(1).max(200).nullable().optional(),
  householdId: z.string().min(1).nullable().optional(),
  assignmentType: z.enum(["STANDARD", "PER_CHILD", "PER_ADULT", "CUSTOM", "REDUCED", "EXEMPT_FULL", "EXEMPT_TEMPORARY", "WAIVER"]),
  requiredMinutesOverride: z.number().int().min(0).max(100_000).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
  exemptUntil: z.coerce.date().nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    // Individual/family-specific overrides (HOUSEHOLD, PROGRAM) require the
    // dedicated per-family adjustment permission — scope-wide rules
    // (ALL/GRADE/CLASSROOM/MEMBERSHIP_PLAN) only need general requirements
    // management authority.
    if (input.scopeType === "HOUSEHOLD" || input.scopeType === "PROGRAM") {
      await requirePtaAccess("pta:volunteer-requirements:adjust-family");
    } else {
      await requirePtaAccess("pta:volunteer-requirements:manage");
    }
    const assignment = await createAssignment(organizationId, periodId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: assignment }, { status: 201 });
  });
}
