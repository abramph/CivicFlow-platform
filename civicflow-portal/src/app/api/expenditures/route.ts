import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";
import { assertCommitteeInOrganization, listExpenditures, type ExpenditureListFilters } from "@/lib/expenditures";

const optionalId = z.union([z.string().min(1), z.literal(""), z.null()]).optional();
const optionalText = (max: number) => z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional();

const expenditureSchema = z.object({
  date: z.string().datetime(),
  vendor: optionalText(255),
  categoryId: optionalId,
  category: optionalText(160),
  amount: z.number().positive(),
  paymentMethodId: optionalId,
  paymentMethod: optionalText(120),
  description: z.string().trim().min(1).max(1000),
  notes: optionalText(4000),
  reference: optionalText(160),
  receiptUrl: optionalText(500),
  campaignId: optionalId,
  eventId: optionalId,
  /// feature/pta-treasurer-expenditure-experience (E3) — see the matching
  /// note on updateExpenditureSchema in [id]/route.ts.
  committeeId: optionalId,
});

function text(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function ensureReference(model: "category" | "paymentMethod" | "campaign" | "event", id: string | null | undefined, organizationId: string) {
  if (!id) return;
  const found =
    model === "category"
      ? await prisma.category.findFirst({ where: { id, organizationId, type: "EXPENDITURE" }, select: { id: true, name: true } })
      : model === "paymentMethod"
        ? await prisma.paymentMethodConfig.findFirst({ where: { id, organizationId }, select: { id: true, label: true } })
        : model === "campaign"
          ? await prisma.campaign.findFirst({ where: { id, organizationId }, select: { id: true } })
          : await prisma.event.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!found) throw new Error(`${model} not found in organization`);
  return found;
}

function readFilters(url: URL): ExpenditureListFilters {
  const params = url.searchParams;
  const status = params.get("status");
  const origin = params.get("origin");
  return {
    dateFrom: params.get("dateFrom") ?? undefined,
    dateTo: params.get("dateTo") ?? undefined,
    categoryId: params.get("categoryId") ?? undefined,
    paymentMethodId: params.get("paymentMethodId") ?? undefined,
    committeeId: params.get("committeeId") ?? undefined,
    vendor: params.get("vendor") ?? undefined,
    status: status === "ACTIVE" || status === "VOIDED" ? status : undefined,
    origin: origin === "DIRECT" || origin === "REIMBURSEMENT" ? origin : undefined,
  };
}

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("expenditures:read", "throw");
    const filters = readFilters(new URL(request.url));
    const rows = await listExpenditures(organizationId, filters);
    await createAuditEvent({ organizationId, actorUserId: session.userId, actorEmail: session.userEmail, action: "list", entityType: "expenditure", metadata: { count: rows.length } });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("expenditures:write", "throw");
    const input = await parseJsonBody(request, expenditureSchema);
    const categoryId = text(input.categoryId);
    const paymentMethodId = text(input.paymentMethodId);
    const campaignId = text(input.campaignId);
    const eventId = text(input.eventId);
    const committeeIdInput = text(input.committeeId);

    const category = await ensureReference("category", categoryId, organizationId) as { name?: string } | undefined;
    const paymentMethod = await ensureReference("paymentMethod", paymentMethodId, organizationId) as { label?: string } | undefined;
    await ensureReference("campaign", campaignId, organizationId);
    await ensureReference("event", eventId, organizationId);
    const committee = committeeIdInput ? await assertCommitteeInOrganization(organizationId, committeeIdInput) : null;

    // State change and audit event commit together (fix/pta-treasurer-financial-controls
    // §6/§9): a direct expenditure is real ledger state the moment it
    // exists, exactly like a paid reimbursement -- an audit-insert failure
    // must not leave a financial record with no audit trail.
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.expenditure.create({
        data: {
          organizationId,
          date: new Date(input.date),
          vendor: text(input.vendor),
          categoryId,
          category: category?.name ?? text(input.category),
          amount: input.amount,
          paymentMethodId,
          paymentMethod: paymentMethod?.label ?? text(input.paymentMethod),
          description: input.description.trim(),
          notes: text(input.notes),
          reference: text(input.reference),
          receiptUrl: text(input.receiptUrl),
          campaignId,
          eventId,
          // feature/pta-treasurer-expenditure-experience (E3) — the
          // snapshot is taken here, server-side, from the just-validated
          // committee row. A client-supplied committeeNameAtPosting is
          // never accepted (the field isn't even in expenditureSchema),
          // so the snapshot can't be spoofed independently of a real,
          // same-organization committeeId.
          committeeId: committee?.id ?? null,
          committeeNameAtPosting: committee?.name ?? null,
        },
      });

      await createAuditEvent({
        organizationId,
        actorUserId: session.userId,
        actorEmail: session.userEmail,
        action: "create",
        entityType: "expenditure",
        entityId: created.id,
        metadata: { amount: created.amount.toString(), date: created.date.toISOString(), vendor: created.vendor },
        tx,
      });
      return created;
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
