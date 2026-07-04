import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/dues?organizationId=...
 * Returns the caller's own dues balance/charges for the given org — never
 * another member's, since organizationId is re-verified against the
 * caller's own OrganizationMembership + linked OrgMember before any query.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const [charges, totals, member] = await Promise.all([
      prisma.duesCharge.findMany({
        where: { organizationId: verifiedOrgId, memberId },
        orderBy: [{ dueDate: "desc" }],
        include: { duesAccount: { select: { name: true } } },
        take: 50,
      }),
      prisma.duesCharge.aggregate({
        where: { organizationId: verifiedOrgId, memberId, status: { in: ["PENDING", "PARTIAL"] } },
        _sum: { amountDue: true, amountPaid: true },
      }),
      prisma.orgMember.findFirst({
        where: { id: memberId, organizationId: verifiedOrgId },
        select: { isDelinquent: true, delinquentSince: true },
      }),
    ]);

    const outstandingBalance = Math.max(
      0,
      Number(totals._sum.amountDue ?? 0) - Number(totals._sum.amountPaid ?? 0)
    );

    return Response.json({
      ok: true,
      data: {
        outstandingBalance,
        isDelinquent: member?.isDelinquent ?? false,
        delinquentSince: member?.delinquentSince,
        charges,
      },
    });
  });
}
