import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z, ValidationError } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { createMemberTimelineEvent } from "@/lib/member-timeline";

const patchSchema = z.object({
  amount: z.number().positive().optional(),
  contributionDate: z.string().datetime().optional(),
  paymentMethod: z
    .enum([
      "CASH",
      "CHECK",
      "CREDIT_CARD",
      "DEBIT_CARD",
      "CARD",
      "ACH",
      "ZELLE",
      "CASH_APP",
      "VENMO",
      "PAYPAL",
      "STRIPE",
      "OTHER",
    ])
    .nullable()
    .optional(),
  notes: z.union([z.string().max(4000), z.literal(""), z.null()]).optional(),
  receiptRequested: z.boolean().optional(),
  editReason: z.string().max(500).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("contributions:read", "throw");
    const { id } = await params;

    const contribution = await prisma.contribution.findFirst({
      where: { id, organizationId },
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, preferredName: true },
        },
        campaign: { select: { id: true, name: true } },
        event: { select: { id: true, title: true } },
        receipts: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!contribution) {
      return Response.json({ error: "Contribution not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: contribution });
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission(
      "contributions:write",
      "throw"
    );
    const { id } = await params;
    const input = await parseJsonBody(req, patchSchema);

    const existing = await prisma.contribution.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      return Response.json({ error: "Contribution not found" }, { status: 404 });
    }
    if (existing.voidedAt) {
      throw new ValidationError("Cannot edit a voided contribution.");
    }
    if (existing.lockedAt && (input.amount !== undefined || input.contributionDate !== undefined)) {
      throw new ValidationError(
        "Amount and date cannot be changed on a locked contribution."
      );
    }

    const notes =
      input.notes !== undefined
        ? typeof input.notes === "string"
          ? input.notes.trim() || null
          : null
        : undefined;

    const updated = await prisma.contribution.update({
      where: { id },
      data: {
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.contributionDate !== undefined
          ? { contributionDate: new Date(input.contributionDate) }
          : {}),
        ...(input.paymentMethod !== undefined
          ? { paymentMethod: input.paymentMethod }
          : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(input.receiptRequested !== undefined
          ? { receiptRequested: input.receiptRequested }
          : {}),
        ...(input.editReason !== undefined
          ? { editReason: input.editReason.trim() || null }
          : {}),
        revisionNumber: { increment: 1 },
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "contribution",
      entityId: id,
      metadata: {
        editReason: input.editReason ?? null,
        changes: Object.keys(input).filter((k) => k !== "editReason"),
      },
    });

    if (
      existing.memberId &&
      (input.amount !== undefined || input.contributionDate !== undefined)
    ) {
      await createMemberTimelineEvent({
        organizationId,
        memberId: existing.memberId,
        eventType: "CONTRIBUTION_RECORDED",
        title: "Contribution updated",
        newValue: {
          contributionId: id,
          amount: updated.amount.toString(),
          editReason: input.editReason ?? null,
        },
        occurredAt: updated.contributionDate,
        createdByUserId: session.userId,
      });
    }

    return Response.json({ ok: true, data: updated });
  });
}
