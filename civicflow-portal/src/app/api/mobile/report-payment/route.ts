import type { PaymentReportCategory } from "@prisma/client";
import { attachmentPrefix, maxAttachmentBytes } from "@/lib/attachments";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileMembership } from "@/lib/mobile-auth";
import { createPaymentReportAndNotify, DUES_PAYMENT_METHODS } from "@/lib/payment-reports";
import { PAYMENT_REPORT_CATEGORIES } from "@/lib/payment-report-categories";
import { prisma } from "@/lib/prisma";
import { requireRateLimit } from "@/lib/rate-limit";
import { buildSafeObjectKey, uploadBufferToSpaces } from "@/lib/storage";
import { ValidationError } from "@/lib/validation";

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * POST /api/mobile/report-payment (multipart/form-data)
 * Fields: organizationId, amount, paymentMethod, paymentDate, referenceNumber?,
 * note?, category? (defaults to MEMBERSHIP_DUES), duesChargeId? (only used
 * when category is MEMBERSHIP_DUES), receipt? (file). Creates a pending
 * PaymentReport and notifies the organization's treasurers/admins for review.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "mobile-report-payment",
      request,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const formData = await request.formData();
    const organizationId = textValue(formData.get("organizationId"));
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { organizationId: verifiedOrgId, memberId } = await requireMobileMembership(request, organizationId);

    const amountRaw = textValue(formData.get("amount"));
    const amount = Number(amountRaw);
    if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("A positive payment amount is required.");
    }

    const paymentMethod = textValue(formData.get("paymentMethod")).toUpperCase();
    if (!(DUES_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      throw new ValidationError("A valid payment method is required.");
    }

    const paymentDateRaw = textValue(formData.get("paymentDate"));
    const paymentDate = paymentDateRaw ? new Date(paymentDateRaw) : null;
    if (!paymentDate || Number.isNaN(paymentDate.getTime())) {
      throw new ValidationError("A valid payment date is required.");
    }

    const referenceNumber = textValue(formData.get("referenceNumber")) || null;
    const note = textValue(formData.get("note")) || null;
    const receipt = formData.get("receipt");

    const categoryRaw = textValue(formData.get("category")).toUpperCase();
    const category = (PAYMENT_REPORT_CATEGORIES as readonly string[]).includes(categoryRaw)
      ? (categoryRaw as PaymentReportCategory)
      : "MEMBERSHIP_DUES";
    const duesChargeId = textValue(formData.get("duesChargeId")) || null;

    const report = await createPaymentReportAndNotify({
      organizationId: verifiedOrgId,
      memberId,
      amount,
      paymentMethod: paymentMethod as (typeof DUES_PAYMENT_METHODS)[number],
      paymentDate,
      referenceNumber,
      note,
      category,
      duesChargeId,
    });

    if (receipt instanceof File && receipt.size > 0) {
      if (receipt.size > maxAttachmentBytes) {
        throw new ValidationError("Receipt exceeds the 15 MB upload limit.");
      }
      const buffer = Buffer.from(await receipt.arrayBuffer());
      const objectKey = buildSafeObjectKey(attachmentPrefix(verifiedOrgId, "PAYMENT_REPORT", report.id), receipt.name);
      await uploadBufferToSpaces({
        key: objectKey,
        buffer,
        contentType: receipt.type || "application/octet-stream",
        metadata: { organizationId: verifiedOrgId, entityType: "PAYMENT_REPORT", entityId: report.id },
      });

      const attachment = await prisma.attachment.create({
        data: {
          organizationId: verifiedOrgId,
          entityType: "PAYMENT_REPORT",
          entityId: report.id,
          fileName: receipt.name,
          contentType: receipt.type || "application/octet-stream",
          byteSize: receipt.size,
          objectKey,
          title: "Payment receipt",
        },
      });

      await prisma.paymentReport.update({
        where: { id: report.id },
        data: { receiptAttachmentId: attachment.id },
      });
    }

    return Response.json({ ok: true, data: report }, { status: 201 });
  });
}
