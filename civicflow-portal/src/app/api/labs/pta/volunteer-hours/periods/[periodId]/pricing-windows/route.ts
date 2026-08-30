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

// FC-6: zone-less wall-clock datetime strings ("YYYY-MM-DDTHH:mm") exactly
// as `<input type="datetime-local">` produces — resolved server-side
// against the owning period's timezone (resolveOrgWallTimeToUtc), never
// `z.coerce.date()`. Also accepts an already-absolute ISO instant (with a
// trailing Z/offset), which the admin settings UI re-submits unchanged when
// toggling a window active/inactive (it resends the window's own
// API-returned `startAt`/`endAt` rather than re-deriving a wall-clock
// string) — resolveOrgWallTimeToUtc recognizes and passes that form through
// as-is. See src/lib/labs/pta/volunteer-hours/timezone.ts.
const wallDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/, "Expected a YYYY-MM-DDTHH:mm date-time");
const bodySchema = z.object({
  name: z.string().min(1).max(120),
  startAt: wallDateTime,
  endAt: wallDateTime,
  rateType: z.enum(["FULL_BUYOUT", "PER_HOUR", "FINAL_ASSESSMENT"]),
  amountCents: z.number().int().min(0).max(10_000_000),
  contractSigningOnly: z.boolean().optional(),
  active: z.boolean().optional(),
  lockTiming: z.enum(["ELECTION", "CHECKOUT"]).optional(),
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
