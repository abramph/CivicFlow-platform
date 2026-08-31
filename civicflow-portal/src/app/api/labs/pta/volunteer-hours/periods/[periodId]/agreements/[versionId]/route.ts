import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { getAgreementVersion, updateAgreementDraft } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const updateDraftSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  effectiveDate: z.string().datetime().optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string; versionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_VIEW, "requirements");
    const { versionId } = await params;
    const version = await getAgreementVersion(organizationId, versionId);
    return Response.json({ ok: true, data: version });
  });
}

/** PATCH — edit a still-DRAFT version. Rejected server-side (not just
 * hidden in the UI) once PUBLISHED — see updateAgreementDraft's own guard. */
export async function PATCH(request: Request, { params }: { params: Promise<{ periodId: string; versionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE, "requirements");
    const { versionId } = await params;
    const input = await parseJsonBody(request, updateDraftSchema);
    const updated = await updateAgreementDraft(
      organizationId,
      versionId,
      { title: input.title, content: input.content, effectiveDate: input.effectiveDate ? new Date(input.effectiveDate) : null },
      { userId: session.userId, userEmail: session.userEmail }
    );
    return Response.json({ ok: true, data: updated });
  });
}
