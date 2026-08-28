import { withApiErrorHandling } from "@/lib/api-route";
import { createPricingWindow, listPricingWindows } from "@/lib/labs/pta/volunteer-hours/pricing";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET(_request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireVolunteerHoursAccess("pta:volunteer-buyout-pricing:manage", "buyout");
    const { periodId } = await params;
    const windows = await listPricingWindows(organizationId, periodId);
    return Response.json({ ok: true, data: windows });
  });
}

const bodySchema = z.object({
  name: z.string().min(1).max(120),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  rateType: z.enum(["FULL_BUYOUT", "PER_HOUR", "FINAL_ASSESSMENT"]),
  amountCents: z.number().int().min(0).max(10_000_000),
  contractSigningOnly: z.boolean().optional(),
  active: z.boolean().optional(),
  lockTiming: z.enum(["CHECKOUT_START", "PAYMENT_SUCCESS"]).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ periodId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-buyout-pricing:manage", "buyout");
    const { periodId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const window = await createPricingWindow(organizationId, periodId, input, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true, data: window }, { status: 201 });
  });
}
