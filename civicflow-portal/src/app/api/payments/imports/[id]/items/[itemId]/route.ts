import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const updateItemSchema = z.object({
  matchedMemberId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  matchedDuesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  matchedCampaignId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  matchedEventId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
  verificationStatus: z.enum(["PENDING_REVIEW", "VERIFIED", "REJECTED"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const { id, itemId } = await params;
    const input = await parseJsonBody(request, updateItemSchema);
    const existing = await prisma.paymentImportItem.findFirst({ where: { id: itemId, batchId: id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Payment import item not found" }, { status: 404 });
    if (existing.verificationStatus === "POSTED") {
      return Response.json({ ok: false, error: "Posted import items cannot be edited." }, { status: 400 });
    }
    const updated = await prisma.paymentImportItem.update({
      where: { id: itemId },
      data: {
        ...(input.matchedMemberId !== undefined ? { matchedMemberId: input.matchedMemberId || null } : {}),
        ...(input.matchedDuesChargeId !== undefined ? { matchedDuesChargeId: input.matchedDuesChargeId || null } : {}),
        ...(input.matchedCampaignId !== undefined ? { matchedCampaignId: input.matchedCampaignId || null } : {}),
        ...(input.matchedEventId !== undefined ? { matchedEventId: input.matchedEventId || null } : {}),
        ...(input.verificationStatus !== undefined ? { verificationStatus: input.verificationStatus, reviewedByUserId: session.userId, reviewedAt: new Date() } : {}),
      },
    });
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "payment_import.review", entityType: "payment_import_item", entityId: updated.id, metadata: { before: existing, after: updated } });
    return Response.json({ ok: true, data: updated });
  });
}
