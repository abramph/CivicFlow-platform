import { withApiErrorHandling } from "@/lib/api-route";
import { getMemberWebSession } from "@/lib/member-web-session";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";
import { createAuditEvent } from "@/lib/audit";
import { assertOrganizationAccess } from "@/lib/subscription-gate";

/** CORE-GIVE-G — statement download: the subject themself (member session)
 * or a statements:generate holder. Signed URL; every download audited
 * (§48/§53 discipline applies to statements too). */
export async function GET(_request: Request, { params }: { params: Promise<{ statementId: string }> }) {
  return withApiErrorHandling(async () => {
    const { statementId } = await params;
    const statement = await prisma.contributionStatement.findUnique({ where: { id: statementId } });
    if (!statement) return Response.json({ ok: false, error: "Statement not found." }, { status: 404 });

    let actorUserId: string | null = null;
    let actorEmail: string | null = null;
    let authorized = false;

    const memberSession = await getMemberWebSession(statement.organizationId);
    if (
      memberSession &&
      memberSession.organizationId === statement.organizationId &&
      (statement.memberId === memberSession.memberId || statement.contributorUserId === memberSession.userId)
    ) {
      authorized = true;
      actorUserId = memberSession.userId;
    }
    // CORE-GIVE-H: a household statement is downloadable by any CURRENT
    // member of that household — but only while the privacy mode still
    // permits household visibility (§29; membership and mode are checked
    // at download time, not issue time).
    if (!authorized && memberSession && statement.householdId && memberSession.memberId) {
      const { getHouseholdGivingSettings } = await import("@/lib/giving/households");
      const { enabled, mode } = await getHouseholdGivingSettings(statement.organizationId);
      if (enabled && mode !== "INDIVIDUAL_PRIVATE") {
        const caller = await prisma.orgMember.findFirst({
          where: {
            id: memberSession.memberId,
            organizationId: statement.organizationId,
            householdId: statement.householdId,
          },
          select: { id: true },
        });
        if (caller) {
          authorized = true;
          actorUserId = memberSession.userId;
        }
      }
    }
    if (!authorized) {
      const { organizationId, session } = await requirePermission("contributions:statements:generate", "throw");
      if (organizationId !== statement.organizationId) {
        return Response.json({ ok: false, error: "Statement not found." }, { status: 404 });
      }
      authorized = true;
      actorUserId = session.userId;
      actorEmail = session.userEmail;
    }

    // E2E-1 finding: the staff fallback above already gates through
    // requirePermission -> requireOrganization -> assertOrganizationAccess,
    // but the member-self-service branches (direct owner, household) never
    // touched the billing gate at all - a member of a billing-inactive org
    // could still download real financial/tax statements. Checking here,
    // unconditionally, closes that gap for every authorization path
    // without having to duplicate it into each branch above.
    await assertOrganizationAccess(statement.organizationId);

    await createAuditEvent({
      organizationId: statement.organizationId,
      actorUserId,
      actorEmail,
      action: "giving.statement_downloaded",
      entityType: "contribution_statement",
      entityId: statement.id,
      metadata: { year: statement.year, version: statement.version },
    });
    const url = await getSignedObjectUrl(statement.objectKey, 300);
    return Response.redirect(url, 302);
  });
}
