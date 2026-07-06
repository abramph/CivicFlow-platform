import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { createPaymentReportAndNotify, DUES_PAYMENT_METHODS } from "@/lib/payment-reports";
import { PAYMENT_REPORT_CATEGORIES } from "@/lib/payment-report-categories";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  amount: z.number().positive(),
  paymentMethod: z.enum(DUES_PAYMENT_METHODS),
  paymentDate: z.string().datetime(),
  referenceNumber: z.union([z.string().max(120), z.literal(""), z.null()]).optional(),
  note: z.union([z.string().max(2000), z.literal(""), z.null()]).optional(),
  category: z.enum(PAYMENT_REPORT_CATEGORIES).optional(),
  duesChargeId: z.union([z.string().min(1), z.literal(""), z.null()]).optional(),
});

/**
 * Web fallback for reporting a payment (no receipt upload — the mobile app
 * is the primary flow for that; this covers members without the app yet).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "member-portal-report-payment",
      request,
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId, memberId } = await requireMemberWebSession(input.organizationId);

    const report = await createPaymentReportAndNotify({
      organizationId,
      memberId,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      paymentDate: new Date(input.paymentDate),
      referenceNumber: input.referenceNumber,
      note: input.note,
      category: input.category,
      duesChargeId: input.duesChargeId || null,
    });

    return Response.json({ ok: true, data: report }, { status: 201 });
  });
}
