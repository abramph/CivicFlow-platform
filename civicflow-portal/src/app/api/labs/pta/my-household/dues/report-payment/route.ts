import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { reportPtaDuesPayment } from "@/lib/labs/pta/parent-dues";
import { DUES_PAYMENT_METHODS } from "@/lib/payment-reports";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  duesChargeId: z.string().nullable().optional(),
  amountCents: z.number().int().positive(),
  paymentMethod: z.enum(DUES_PAYMENT_METHODS as unknown as [string, ...string[]]),
  paymentDate: z.coerce.date(),
  referenceNumber: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

/** Parent self-service "I already paid" report — creates a pending PaymentReport for officer review, exactly the platform's existing report-a-payment mechanism (see parent-dues.ts's module doc for why this, not a new Stripe reconciliation path). Household id is always resolved server-side, never accepted from the client. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:pta:parent:report-payment", request, limit: 10, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, adult, session } = await requirePtaHouseholdSelfAccess();
    const input = await parseJsonBody(request, bodySchema);
    const report = await reportPtaDuesPayment({
      organizationId,
      householdId: adult.householdId,
      actorUserId: session.userId,
      ...input,
      paymentMethod: input.paymentMethod as (typeof DUES_PAYMENT_METHODS)[number],
    });
    return Response.json({ ok: true, data: report });
  });
}
