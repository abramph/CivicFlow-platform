import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { createAgreementDraft, listAgreementVersions } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const createDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  effectiveDate: z.string().datetime().optional(),
});

/** GET — list every version (DRAFT/PUBLISHED/ARCHIVED) for this period,
 * newest first. Requirements-view is sufficient (matches how assignment
 * status is already visible to STAFF/READ_ONLY). */
export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW, "requirements");
    const { periodId } = await params;
    const versions = await listAgreementVersions(organizationId, periodId);
    return Response.json({ ok: true, data: versions });
  });
}

/** POST — create a new DRAFT version. requirements:manage — the same
 * permission STAFF already holds for period/assignment configuration;
 * publishing an agreement is treated as a period-configuration task, not a
 * financial one (contract-linked PRICING policy is gated separately, more
 * strictly, on the agreement-policy route). */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE, "requirements");
    const { periodId } = await params;
    const input = await parseJsonBody(request, createDraftSchema);
    const draft = await createAgreementDraft(
      organizationId,
      periodId,
      { title: input.title, content: input.content, effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null },
      { userId: session.userId, userEmail: session.userEmail }
    );
    return Response.json({ ok: true, data: draft }, { status: 201 });
  });
}
