import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { resolveAndRecordDuesPayment, createDuesPaymentSchema } from "@/lib/dues-payment-creation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:read", "throw");

    const rows = await prisma.duesPayment.findMany({
      where: { organizationId },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, duesCharge: true, duesAccount: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "dues_payment",
      metadata: { count: rows.length },
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:dues:write",
      request,
      limit: 50,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createDuesPaymentSchema);

    const result = await resolveAndRecordDuesPayment(organizationId, { userId: session.userId, userEmail: session.userEmail }, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data }, { status: 201 });
  });
}
