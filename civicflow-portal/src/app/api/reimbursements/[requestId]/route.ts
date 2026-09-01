import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { transitionReimbursement } from "@/lib/reimbursements";
import { parseJsonBody, z } from "@/lib/validation";

/** GET /api/reimbursements/:id — a manager, or the submitter themself. */
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session, can } = await requirePermission("reimbursements:submit", "throw");
    const { requestId } = await params;
    const row = await prisma.reimbursementRequest.findFirst({
      where: {
        id: requestId,
        organizationId,
        ...(can("reimbursements:manage") ? {} : { submittedByUserId: session.userId }),
      },
      include: {
        submittedBy: { select: { displayName: true, email: true } },
        approvedBy: { select: { displayName: true, email: true } },
        paidBy: { select: { displayName: true, email: true } },
        rejectedBy: { select: { displayName: true, email: true } },
        correctedBy: { select: { displayName: true, email: true } },
        category: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        committee: { select: { id: true, name: true } },
        paymentMethodConfig: { select: { id: true, method: true, label: true } },
      },
    });
    if (!row) return Response.json({ ok: false, error: "Reimbursement request not found." }, { status: 404 });
    return Response.json({ ok: true, data: row });
  });
}

const patchSchema = z.object({
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PAID", "REJECTED", "VOIDED", "REVERSED"]),
  reviewNotes: z.string().max(4000).nullable().optional(),
  rejectionReason: z.string().max(2000).nullable().optional(),
  paymentReference: z.string().max(200).nullable().optional(),
  paymentMethodId: z.string().max(64).nullable().optional(),
  correctionReason: z.string().max(2000).nullable().optional(),
  confirmText: z.string().max(20).nullable().optional(),
});

/** PATCH — workflow transitions; manage-permission only. The lib enforces
 * the transition table, self-approval/self-payment/self-correction ban,
 * the PAID booking (required structured payment method, CAS-guarded), and
 * the VOIDED/REVERSED correction (reason + typed confirmation required,
 * CAS-guarded, voids the linked Expenditure). */
export async function PATCH(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("reimbursements:manage", "throw");
    const { requestId } = await params;
    const input = await parseJsonBody(request, patchSchema);
    const row = await transitionReimbursement({
      organizationId,
      requestId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: row });
  });
}
