import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/payment-history?organizationId=...
 * Combines confirmed DuesPayment records with the caller's self-reported
 * PaymentReports (including ones still pending/rejected) so members can see
 * the full status of everything they've paid or reported.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const [payments, reports] = await Promise.all([
      prisma.duesPayment.findMany({
        where: { organizationId: verifiedOrgId, memberId },
        orderBy: [{ paymentDate: "desc" }],
        take: 50,
      }),
      prisma.paymentReport.findMany({
        where: { organizationId: verifiedOrgId, memberId },
        orderBy: [{ createdAt: "desc" }],
        take: 50,
      }),
    ]);

    return Response.json({ ok: true, data: { payments, reports } });
  });
}
