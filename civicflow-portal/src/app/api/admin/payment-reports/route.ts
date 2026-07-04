import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["pending", "approved", "rejected"] as const;

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("dues:read", "throw");
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const status = (VALID_STATUSES as readonly string[]).includes(statusParam ?? "")
      ? (statusParam as (typeof VALID_STATUSES)[number])
      : undefined;

    const rows = await prisma.paymentReport.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "desc" }],
      include: {
        member: { select: { id: true, firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { id: true, displayName: true, email: true } },
        receiptAttachment: { select: { id: true, fileName: true } },
      },
      take: 200,
    });

    return Response.json({ ok: true, data: rows });
  });
}
