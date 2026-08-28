import { withApiErrorHandling } from "@/lib/api-route";
import { deletePricingWindow, updatePricingWindow } from "@/lib/labs/pta/volunteer-hours/pricing";
import { requireVolunteerHoursAccess } from "@/lib/labs/pta/volunteer-hours/guard";
import { parseJsonBody, z } from "@/lib/validation";

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

export async function PATCH(request: Request, { params }: { params: Promise<{ periodId: string; windowId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-buyout-pricing:manage", "buyout");
    const { periodId, windowId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const window = await updatePricingWindow(organizationId, periodId, windowId, input, {
      userId: session.userId,
      userEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: window });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ periodId: string; windowId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireVolunteerHoursAccess("pta:volunteer-buyout-pricing:manage", "buyout");
    const { windowId } = await params;
    await deletePricingWindow(organizationId, windowId, { userId: session.userId, userEmail: session.userEmail });
    return Response.json({ ok: true });
  });
}
