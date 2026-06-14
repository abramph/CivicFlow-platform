import type { PaymentImportSourceType, Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { buildPaymentImportItemData, parsePaymentCsv } from "@/lib/payment-reconciliation";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const sourceTypes = ["ZELLE", "CASH_APP", "VENMO", "PAYPAL", "STRIPE", "BANK", "MANUAL_CSV", "OTHER"] as const;

const createImportSchema = z.object({
  sourceType: z.enum(sourceTypes),
  fileName: z.union([z.string().max(255), z.literal(""), z.null()]).optional(),
  csvText: z.string().min(1),
  notes: z.union([z.string().max(2000), z.literal(""), z.null()]).optional(),
});

function text(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("dues:read", "throw");
    const rows = await prisma.paymentImportBatch.findMany({
      where: { organizationId },
      orderBy: { uploadedAt: "desc" },
      include: { _count: { select: { items: true } } },
      take: 100,
    });
    return Response.json({ ok: true, data: rows });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:payments:imports", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { session, organizationId } = await requirePermission("dues:write", "throw");
    const input = await parseJsonBody(request, createImportSchema);
    const parsedRows = parsePaymentCsv(input.csvText);
    if (parsedRows.length === 0) {
      return Response.json({ ok: false, error: "CSV did not contain any payment rows." }, { status: 400 });
    }

    const batch = await prisma.paymentImportBatch.create({
      data: {
        organizationId,
        sourceType: input.sourceType,
        fileName: text(input.fileName),
        status: "UPLOADED",
        uploadedByUserId: session.userId,
        notes: text(input.notes),
      },
    });

    const itemData = [];
    for (const row of parsedRows) {
      const data = await buildPaymentImportItemData(organizationId, input.sourceType as PaymentImportSourceType, row);
      if (!Number.isFinite(data.amount) || data.amount <= 0) continue;
      itemData.push({
        ...data,
        organizationId,
        batchId: batch.id,
        rawData: data.rawData as Prisma.InputJsonValue,
      });
    }

    for (const data of itemData) {
      await prisma.paymentImportItem.upsert({
        where: {
          organizationId_sourceType_externalTransactionId: {
            organizationId,
            sourceType: data.sourceType,
            externalTransactionId: data.externalTransactionId ?? `NO_ID_${batch.id}_${itemData.indexOf(data)}`,
          },
        },
        update: {},
        create: data,
      });
    }

    const updated = await prisma.paymentImportBatch.update({
      where: { id: batch.id },
      data: { status: "PARSED", processedAt: new Date() },
      include: { _count: { select: { items: true } } },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "payment_import.create",
      entityType: "payment_import_batch",
      entityId: batch.id,
      metadata: { sourceType: batch.sourceType, itemCount: itemData.length, fileName: batch.fileName },
    });

    return Response.json({ ok: true, data: updated }, { status: 201 });
  });
}
