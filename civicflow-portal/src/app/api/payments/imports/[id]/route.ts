import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("dues:read", "throw");
    const { id } = await params;
    const batch = await prisma.paymentImportBatch.findFirst({
      where: { id, organizationId },
      include: {
        items: {
          orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
          include: { matchedMember: true, matchedDuesCharge: true, matchedCampaign: true, matchedEvent: true },
        },
      },
    });
    if (!batch) return Response.json({ ok: false, error: "Payment import batch not found" }, { status: 404 });
    return Response.json({ ok: true, data: batch });
  });
}
