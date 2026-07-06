import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/validation";

/**
 * GET /api/mobile/payment-methods?organizationId=...
 * The org's configured "ways to pay" (Zelle/CashApp/etc.) for the mobile
 * app's Dues and Make a Payment screens — mirrors the member web portal.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId } = await requireMobileMembership(request, organizationId);

    const methods = await prisma.paymentMethodConfig.findMany({
      where: { organizationId: verifiedOrgId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, label: true, accountIdentifier: true, instructions: true },
    });
    // Only surface methods staff actually configured with a handle/instructions —
    // default seeded rows (e.g. "Cash", "Check") have neither and aren't actionable here.
    const payableMethods = methods.filter((method) => method.accountIdentifier || method.instructions);

    return Response.json({ ok: true, data: payableMethods });
  });
}
