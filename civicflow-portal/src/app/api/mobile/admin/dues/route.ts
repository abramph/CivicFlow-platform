import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";
import { requireMobilePaymentsPermission } from "@/lib/mobile-admin-payments";
import { PERMISSIONS } from "@/lib/rbac";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/admin/dues?organizationId=...&memberId=...
 * A single member's dues charges/payments/adjustments -- the read side an
 * officer needs before deciding to record a payment or adjustment. Mirrors
 * the data shown on the web member detail page's "Dues & Payments" tab,
 * scoped tighter to just this member (not the org-wide /dues list).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const memberId = searchParams.get("memberId");
    if (!organizationId) throw new ValidationError("organizationId is required");
    if (!memberId) throw new ValidationError("memberId is required");

    await requireMobilePaymentsPermission(request, organizationId, "managePayments", PERMISSIONS.DUES_READ);

    const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
    }

    const [charges, payments, adjustments] = await Promise.all([
      prisma.duesCharge.findMany({
        where: { organizationId, memberId },
        orderBy: [{ dueDate: "desc" }],
        take: 50,
        select: {
          id: true,
          amountDue: true,
          amountPaid: true,
          dueDate: true,
          status: true,
          duesAccountId: true,
        },
      }),
      prisma.duesPayment.findMany({
        where: { organizationId, memberId },
        orderBy: [{ paymentDate: "desc" }],
        take: 20,
        select: { id: true, amount: true, paymentDate: true, method: true, reference: true, duesChargeId: true },
      }),
      prisma.duesAdjustment.findMany({
        where: { organizationId, memberId },
        orderBy: [{ createdAt: "desc" }],
        take: 20,
        select: { id: true, adjustmentType: true, amount: true, reason: true, duesChargeId: true, createdAt: true },
      }),
    ]);

    return Response.json({
      ok: true,
      data: {
        member: { id: member.id, firstName: member.firstName, lastName: member.lastName, isDelinquent: member.isDelinquent },
        charges,
        payments,
        adjustments,
      },
    });
  });
}
