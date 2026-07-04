import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";

/**
 * Lists every organization the caller has an active MEMBER-role membership
 * in, along with their linked OrgMember summary — backs the mobile org
 * switcher for members belonging to multiple organizations.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { userId } = await requireMobileAuth(request);

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId, role: "MEMBER", organization: { status: "active" } },
      orderBy: { joinedAt: "asc" },
      include: { organization: { select: { id: true, name: true, logoUrl: true } } },
    });

    const members = await prisma.orgMember.findMany({
      where: { userId, organizationId: { in: memberships.map((m) => m.organizationId) } },
      select: {
        id: true,
        organizationId: true,
        firstName: true,
        lastName: true,
        membershipStatus: true,
        isDelinquent: true,
      },
    });
    const memberByOrgId = new Map(members.map((m) => [m.organizationId, m]));

    const data = memberships
      .map((membership) => {
        const member = memberByOrgId.get(membership.organizationId);
        if (!member) return null;
        return {
          organizationId: membership.organizationId,
          organizationName: membership.organization.name,
          organizationLogoUrl: membership.organization.logoUrl,
          memberId: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          membershipStatus: member.membershipStatus,
          isDelinquent: member.isDelinquent,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return Response.json({ ok: true, data });
  });
}
