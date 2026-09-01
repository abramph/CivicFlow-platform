import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { canEditFinancialRecord, getFinancialEditPolicy } from "@/lib/financial-edit-policy";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

const updateExpenditureSchema = z.object({
  date: z.string().datetime().optional(),
  vendor: optionalText(255),
  categoryId: optionalId,
  category: optionalText(160),
  amount: z.number().positive().optional(),
  paymentMethodId: optionalId,
  paymentMethod: optionalText(120),
  description: z.string().trim().min(1).max(1000).optional(),
  notes: optionalText(4000),
  reference: optionalText(160),
  receiptUrl: optionalText(500),
  campaignId: optionalId,
  eventId: optionalId,
  editReason: optionalText(1000),
  voidReason: optionalText(1000),
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("expenditures:read", "throw");
    const { id } = await params;
    const row = await prisma.expenditure.findFirst({
      where: { id, organizationId },
      include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true },
    });
    if (!row) return Response.json({ ok: false, error: "Expenditure not found" }, { status: 404 });
    return Response.json({ ok: true, data: row });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId, role } = await requirePermission("expenditures:write", "throw");
    const { id } = await params;
    const input = await parseJsonBody(request, updateExpenditureSchema);
    const existing = await prisma.expenditure.findFirst({ where: { id, organizationId } });
    if (!existing) return Response.json({ ok: false, error: "Expenditure not found" }, { status: 404 });

    const policy = await getFinancialEditPolicy(organizationId);
    const editCheck = canEditFinancialRecord({
      record: existing,
      role,
      policy,
      editReason: text(input.editReason),
    });
    if (!editCheck.allowed) {
      return Response.json({ ok: false, error: editCheck.reason }, { status: 403 });
    }

    // State change and audit event commit together (fix/pta-treasurer-financial-controls
    // §6/§9) -- edit and void both go through this one PATCH, and neither
    // should be able to commit without its audit record.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expenditure.update({
        where: { id },
        data: {
          ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
          ...(input.vendor !== undefined ? { vendor: text(input.vendor) } : {}),
          ...(input.categoryId !== undefined ? { categoryId: text(input.categoryId) } : {}),
          ...(input.category !== undefined ? { category: text(input.category) } : {}),
          ...(input.amount !== undefined ? { amount: input.amount } : {}),
          ...(input.paymentMethodId !== undefined ? { paymentMethodId: text(input.paymentMethodId) } : {}),
          ...(input.paymentMethod !== undefined ? { paymentMethod: text(input.paymentMethod) } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() } : {}),
          ...(input.notes !== undefined ? { notes: text(input.notes) } : {}),
          ...(input.reference !== undefined ? { reference: text(input.reference) } : {}),
          ...(input.receiptUrl !== undefined ? { receiptUrl: text(input.receiptUrl) } : {}),
          ...(input.campaignId !== undefined ? { campaignId: text(input.campaignId) } : {}),
          ...(input.eventId !== undefined ? { eventId: text(input.eventId) } : {}),
          ...(input.editReason !== undefined ? { editReason: text(input.editReason), revisionNumber: { increment: 1 } } : {}),
          ...(input.voidReason !== undefined && text(input.voidReason)
            ? { voidReason: text(input.voidReason), voidedAt: new Date(), voidedByUserId: session.userId }
            : {}),
        },
      });

      // receiptUrl is excluded from audit metadata -- it's a pointer into
      // private object storage, not something an audit-log reader needs,
      // and audit records outlive normal access-control review cycles.
      const beforeSansReceipt = omit(existing, "receiptUrl");
      const afterSansReceipt = omit(result, "receiptUrl");
      await createAuditEvent({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        action: input.voidReason !== undefined && text(input.voidReason) ? "void" : "update",
        entityType: "expenditure",
        entityId: result.id,
        metadata: { before: beforeSansReceipt, after: afterSansReceipt },
        tx,
      });
      return result;
    });

    return Response.json({ ok: true, data: updated });
  });
}
