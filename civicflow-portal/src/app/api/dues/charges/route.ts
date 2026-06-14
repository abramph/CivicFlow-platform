import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";

const createDuesChargeSchema = z.object({
  memberId: z.string().min(1),
  duesAccountId: z.string().min(1),
  amountDue: z.number().nonnegative(),
  dueDate: z.string().datetime(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:read", "throw");

    const rows = await prisma.duesCharge.findMany({
      where: { organizationId },
      orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
      include: { member: true, duesAccount: true },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "dues_charge",
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
      limit: 40,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createDuesChargeSchema);

    const member = await prisma.orgMember.findFirst({ where: { id: input.memberId, organizationId } });
    if (!member) {
      return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
    }

    const account = await prisma.duesAccount.findFirst({ where: { id: input.duesAccountId, organizationId } });
    if (!account) {
      return Response.json({ ok: false, error: "Dues account not found in organization" }, { status: 404 });
    }

    if (account.memberId && account.memberId !== input.memberId) {
      return Response.json(
        { ok: false, error: "The selected dues account is already assigned to a different member." },
        { status: 400 }
      );
    }

    const row = await prisma.duesCharge.create({
      data: {
        organizationId,
        memberId: input.memberId,
        duesAccountId: input.duesAccountId,
        amountDue: input.amountDue,
        dueDate: new Date(input.dueDate),
        notes: typeof input.notes === "string" ? input.notes.trim() || null : input.notes ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "dues_charge",
      entityId: row.id,
      metadata: { amountDue: row.amountDue.toString(), dueDate: row.dueDate.toISOString() },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
