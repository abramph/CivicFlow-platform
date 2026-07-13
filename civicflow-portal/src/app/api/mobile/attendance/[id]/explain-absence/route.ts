import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  explanation: z.string().trim().min(1).max(2000),
});

/**
 * Lets a member add their own explanation to an ABSENT record recorded
 * against them — e.g. staff marked them absent and they want to note why.
 * Only ever touches the caller's own record (memberId is re-derived from
 * the mobile session, never trusted from the request), and only an
 * existing ABSENT record — this doesn't let a member invent attendance
 * history for a meeting nothing was ever recorded for.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, bodySchema);
    const { memberId } = await requireMobileMembership(request, input.organizationId);
    const { id } = await params;

    const record = await prisma.attendanceRecord.findFirst({
      where: { id, organizationId: input.organizationId, memberId },
    });
    if (!record) return Response.json({ ok: false, error: "Attendance record not found" }, { status: 404 });
    if (record.attendanceStatus !== "ABSENT") {
      return Response.json({ ok: false, error: "An explanation can only be added to an absence record." }, { status: 400 });
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id },
      data: { correctionReason: input.explanation },
    });

    await createAuditEvent({
      organizationId: input.organizationId,
      action: "member_explain_absence",
      entityType: "attendance_record",
      entityId: id,
      metadata: { memberId },
    });

    return Response.json({ ok: true, data: updated });
  });
}
