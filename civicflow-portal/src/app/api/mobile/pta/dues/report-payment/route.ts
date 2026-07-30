import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobilePtaHouseholdAccess } from "@/lib/mobile-auth";
import { reportPtaDuesPayment } from "@/lib/labs/pta/parent-dues";
import { DUES_PAYMENT_METHODS } from "@/lib/payment-reports";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  duesChargeId: z.string().nullable().optional(),
  amountCents: z.number().int().positive(),
  paymentMethod: z.enum(DUES_PAYMENT_METHODS as unknown as [string, ...string[]]),
  paymentDate: z.coerce.date(),
  referenceNumber: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * POST /api/mobile/pta/dues/report-payment
 * Mobile bridge for the caller's own household's "I already paid" report —
 * creates a pending PaymentReport for officer review via the same
 * `reportPtaDuesPayment()` the web uses (parent-dues.ts, unmodified). This
 * is deliberately NOT an automatic-reconciliation payment flow — see that
 * module's doc comment for why. The mobile "Open payment options" action is
 * a separate, simpler affordance (opens the existing PaymentLink, no new
 * route needed) — this route only covers "Report a payment".
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:pta:report-payment", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const input = await parseJsonBody(request, bodySchema);
    const { organizationId: verifiedOrgId, session, adult } = await requireMobilePtaHouseholdAccess(request, input.organizationId);

    const report = await reportPtaDuesPayment({
      organizationId: verifiedOrgId,
      householdId: adult.householdId,
      actorUserId: session.userId,
      duesChargeId: input.duesChargeId ?? null,
      amountCents: input.amountCents,
      paymentMethod: input.paymentMethod as (typeof DUES_PAYMENT_METHODS)[number],
      paymentDate: input.paymentDate,
      referenceNumber: input.referenceNumber ?? null,
      note: input.note ?? null,
    });
    return Response.json({ ok: true, data: report });
  });
}
