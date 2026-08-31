import { PERMISSIONS } from "@/lib/rbac";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { archiveAgreementVersion } from "@/lib/labs/pta/volunteer-hours/agreements";
import { parseJsonBody, z } from "@/lib/validation";

const archiveBodySchema = z.object({ replacementVersionId: z.string().min(1).optional() }).strict();

/** FA2 §5: `replacementVersionId` is required only when the version being
 * archived is the period's CURRENT actively-required assignment — see
 * archiveAgreementVersion's own doc comment for the atomic-swap contract.
 * An empty body ({}) is the common case (archiving a superseded or
 * not-currently-assigned version). */
export async function POST(request: Request, { params }: { params: Promise<{ periodId: string; versionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess(PERMISSIONS.PTA_VOLUNTEER_REQUIREMENTS_MANAGE, "requirements");
    const { versionId } = await params;
    const input = await parseJsonBody(request, archiveBodySchema);
    const archived = await archiveAgreementVersion(
      organizationId,
      versionId,
      { userId: session.userId, userEmail: session.userEmail },
      input.replacementVersionId
    );
    return Response.json({ ok: true, data: archived });
  });
}
