import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationResidentAccess } from "@/lib/hoa/violations-guard";
import { toResidentSafeViolation } from "@/lib/hoa/violations";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return Response.json({ ok: false, error: "organizationId is required" }, { status: 400 });
    }
    const { violationId } = await params;

    await requireHoaViolationResidentAccess(organizationId, violationId);

    const violation = await prisma.violation.findFirst({
      where: { id: violationId, organizationId },
      include: { notices: { orderBy: { sentAt: "desc" } }, comments: { orderBy: { createdAt: "desc" } } },
    });
    // requireHoaViolationResidentAccess() already confirmed this row
    // exists and is accessible; re-fetching here (rather than reusing its
    // return value) is just to pick up the notices/comments includes.
    return Response.json({ ok: true, data: toResidentSafeViolation(violation!) });
  });
}
