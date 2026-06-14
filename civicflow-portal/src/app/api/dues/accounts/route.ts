import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";

const createDuesAccountSchema = z.object({
  name: z.string().min(1).max(200),
  memberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  categoryId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  amountDefault: z.number().nonnegative().nullable().optional(),
  frequency: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:read", "throw");

    const rows = await prisma.duesAccount.findMany({
      where: { organizationId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        member: true,
        category: true,
        _count: {
          select: {
            charges: true,
          },
        },
      },
      take: 200,
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "list",
      entityType: "dues_account",
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
    const input = await parseJsonBody(request, createDuesAccountSchema);
    const memberId = input.memberId || null;
    const categoryId = input.categoryId || null;
    const notes = typeof input.notes === "string" ? input.notes.trim() || null : input.notes ?? null;

    if (memberId) {
      const member = await prisma.orgMember.findFirst({ where: { id: memberId, organizationId } });
      if (!member) {
        return Response.json({ ok: false, error: "Member not found in organization" }, { status: 404 });
      }
    }

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: {
          id: categoryId,
          organizationId,
          type: "DUES",
        },
      });
      if (!category) {
        return Response.json({ ok: false, error: "Dues category not found in organization" }, { status: 404 });
      }
    }

    const row = await prisma.duesAccount.create({
      data: {
        organizationId,
        name: input.name,
        memberId,
        categoryId,
        amountDefault: input.amountDefault ?? null,
        frequency: input.frequency ?? "monthly",
        isActive: input.isActive ?? true,
        notes,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "dues_account",
      entityId: row.id,
      metadata: {
        name: row.name,
        memberId: row.memberId,
        categoryId: row.categoryId,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
