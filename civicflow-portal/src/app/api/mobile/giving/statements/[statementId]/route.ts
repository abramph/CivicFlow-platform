import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { getSignedObjectUrl } from "@/lib/storage";
import { createAuditEvent } from "@/lib/audit";
import { ValidationError } from "@/lib/validation";

/**
 * CORE-GIVE-L — mobile statement download: SUBJECT ONLY (the caller's own
 * member/contributor statements; household statements stay web-only in
 * mobile V1). Signed URL, audited, same §48 discipline as the web route.
 */
export async function GET(request: Request, { params }: { params: Promise<{ statementId: string }> }) {
  return withApiErrorHandling(async () => {
    const { statementId } = await params;
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");
    const { session: mobileSession, organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const statement = await prisma.contributionStatement.findFirst({
      where: {
        id: statementId,
        organizationId: verifiedOrgId,
        OR: [{ memberId }, { contributorUserId: mobileSession.userId }],
      },
    });
    if (!statement) return Response.json({ ok: false, error: "Statement not found." }, { status: 404 });

    await createAuditEvent({
      organizationId: verifiedOrgId,
      actorUserId: mobileSession.userId,
      action: "giving.statement_downloaded",
      entityType: "contribution_statement",
      entityId: statement.id,
      metadata: { year: statement.year, version: statement.version, via: "mobile" },
    });
    const url = await getSignedObjectUrl(statement.objectKey, 300);
    return Response.json({ ok: true, data: { url } });
  });
}
