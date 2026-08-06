import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { resumeBatch } from "@/lib/imports/engine";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = await requireRateLimit({ scope: "api:imports:resume", request, limit: 20, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("imports:resume", "throw");
    const { id } = await params;

    await resumeBatch(id, organizationId, session.userId);

    const updated = await prisma.importBatch.findFirst({ where: { id, organizationId } });
    return Response.json({ ok: true, data: { status: updated?.status } });
  });
}
