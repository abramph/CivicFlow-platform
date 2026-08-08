import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { createReceiptForContribution, createReceiptSchema } from "@/lib/receipt-mutations";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("receipts:read", "throw");

    const rows = await prisma.contributionReceipt.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }],
      include: { contribution: true, member: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "receipt",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:receipts:write",
      request,
      limit: 40,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("receipts:write", "throw");
    const input = await parseJsonBody(request, createReceiptSchema);

    const result = await createReceiptForContribution(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data, ...(result.existing ? { existing: true } : {}) }, { status: result.existing ? 200 : 201 });
  });
}
