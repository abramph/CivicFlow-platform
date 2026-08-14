import { withApiErrorHandling } from "@/lib/api-route";
import { getMemberWebSession } from "@/lib/member-web-session";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";
import { createAuditEvent } from "@/lib/audit";

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
    if (!authorized) {
      const { organizationId, session } = await requirePermission("contributions:statements:generate", "throw");
      if (organizationId !== statement.organizationId) {
        return Response.json({ ok: false, error: "Statement not found." }, { status: 404 });
      }
      authorized = true;
      actorUserId = session.userId;
      actorEmail = session.userEmail;
    }

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
