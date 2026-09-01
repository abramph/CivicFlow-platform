import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { canEditFinancialRecord, canVoidFinancialRecord, getFinancialEditPolicy } from "@/lib/financial-edit-policy";
import { assertCommitteeInOrganization, voidExpenditure } from "@/lib/expenditures";
import { FinanceError } from "@/lib/finance-errors";
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
  /// feature/pta-treasurer-expenditure-experience (E3) — PTA-only in
  /// practice (assertCommitteeInOrganization rejects any id that isn't a
  /// PtaCommittee row in this organization), but the field itself is
  /// vertical-agnostic and simply stays unused for non-PTA organizations.
  committeeId: optionalId,
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
      include: { categoryRef: true, paymentMethodConfig: true, campaign: true, event: true, committee: { select: { id: true, name: true } }, reimbursement: { select: { id: true, payeeName: true } } },
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

    const voidReason = text(input.voidReason);

    // feature/pta-treasurer-expenditure-experience (E2) — voiding is now a
    // distinct, narrow action rather than a field bundled into an ordinary
    // edit: a void request carries ONLY a voidReason and touches nothing
    // else, so the UI's "Void" control can never be used as a side door to
    // sneak other field changes past review. It also requires the dedicated
    // canVoidFinancialRecord(role) role gate on top of the edit-window
    // policy above -- every role that currently holds expenditures:write
    // already satisfies this gate too, but a future org-custom role (see
    // OrgRolePermissionSet) could grant expenditures:write more broadly
    // without this route silently inheriting void authority along with it.
    if (voidReason !== undefined && voidReason !== null) {
      if (!canVoidFinancialRecord(role)) {
        return Response.json({ ok: false, error: "Voiding a financial record requires finance/admin permission." }, { status: 403 });
      }

      try {
        const updated = await voidExpenditure({
          organizationId,
          expenditureId: id,
          reason: voidReason,
          actorUserId: session.userId,
          actorEmail: session.userEmail,
          existing,
        });
        return Response.json({ ok: true, data: updated });
      } catch (error) {
        if (error instanceof FinanceError) {
          return Response.json({ ok: false, error: error.message }, { status: error.status });
        }
        throw error;
      }
    }

    let committeeId: string | null | undefined;
    let committeeNameAtPosting: string | null | undefined;
    if (input.committeeId !== undefined) {
      const rawCommitteeId = text(input.committeeId);
      if (rawCommitteeId) {
        const committee = await assertCommitteeInOrganization(organizationId, rawCommitteeId);
        committeeId = committee.id;
        committeeNameAtPosting = committee.name;
      } else {
        committeeId = null;
        committeeNameAtPosting = null;
      }
    }

    // State change and audit event commit together (fix/pta-treasurer-financial-controls
    // §6/§9) -- an audit-insert failure must not leave a financial record
    // edit with no audit trail.
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
          ...(committeeId !== undefined ? { committeeId, committeeNameAtPosting } : {}),
          ...(input.editReason !== undefined ? { editReason: text(input.editReason), revisionNumber: { increment: 1 } } : {}),
        },
      });

      const beforeSansReceipt = omit(existing, "receiptUrl");
      const afterSansReceipt = omit(result, "receiptUrl");
      await createAuditEvent({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        action: "update",
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
