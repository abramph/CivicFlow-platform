import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { PtaError } from "@/lib/labs/pta/errors";
import { deleteAssignment } from "@/lib/labs/pta/volunteer-hours/assignments";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ periodId: string; assignmentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-requirements:view", "requirements");
    const { assignmentId } = await params;

    const existing = await prisma.ptaVolunteerRequirementAssignment.findFirst({
      where: { id: assignmentId, organizationId },
      select: { scopeType: true },
    });
    if (!existing) throw new PtaError("PTA_VALIDATION_ERROR", "Assignment not found in this organization.");

    if (existing.scopeType === "HOUSEHOLD" || existing.scopeType === "PROGRAM") {
      await requirePtaAccess("pta:volunteer-requirements:adjust-family");
    } else {
      await requirePtaAccess("pta:volunteer-requirements:manage");
    }

    await deleteAssignment(organizationId, assignmentId, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true });
  });
}
