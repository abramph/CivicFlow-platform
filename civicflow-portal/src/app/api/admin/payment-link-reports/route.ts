import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("payment_link_reports:review", "throw");

    const reports = await prisma.paymentLinkOfflineReport.findMany({
      where: { organizationId },
      include: {
        paymentLink: { select: { id: true, title: true, slug: true } },
        paymentMethodConfig: { select: { method: true, label: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    return Response.json({ ok: true, data: reports });
  });
}
