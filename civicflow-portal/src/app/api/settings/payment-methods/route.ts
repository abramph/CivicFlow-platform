import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { ensureDefaultPaymentMethods } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const paymentMethodValues = [
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
] as const;

const createPaymentMethodSchema = z.object({
  method: z.enum(paymentMethodValues),
  label: z.string().trim().min(1).max(120),
  instructions: z.union([z.string().trim().max(1000), z.literal(""), z.null()]).optional(),
  accountIdentifier: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
  notes: z.union([z.string().trim().max(2000), z.literal(""), z.null()]).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("org_settings:read", "throw");

    await ensureDefaultPaymentMethods(prisma, organizationId);

    const rows = await prisma.paymentMethodConfig.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });

    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, createPaymentMethodSchema);

    const row = await prisma.paymentMethodConfig.upsert({
      where: {
        organizationId_method: {
          organizationId,
          method: input.method,
        },
      },
      update: {
        label: input.label.trim(),
        instructions: normalizeOptionalText(input.instructions),
        accountIdentifier: normalizeOptionalText(input.accountIdentifier),
        notes: normalizeOptionalText(input.notes),
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
      create: {
        organizationId,
        method: input.method,
        label: input.label.trim(),
        instructions: normalizeOptionalText(input.instructions) ?? null,
        accountIdentifier: normalizeOptionalText(input.accountIdentifier) ?? null,
        notes: normalizeOptionalText(input.notes) ?? null,
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "payment_method_config",
      entityId: row.id,
      metadata: {
        method: row.method,
        label: row.label,
        accountIdentifier: row.accountIdentifier,
        isActive: row.isActive,
      },
    });

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
