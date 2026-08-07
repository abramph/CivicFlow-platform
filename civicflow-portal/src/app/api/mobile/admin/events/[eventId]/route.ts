import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { resolveMobileAdminCapabilities } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";
import { updateEvent, updateEventSchema } from "@/lib/event-mutations";

const updateMobileEventSchema = updateEventSchema.extend({ organizationId: z.string().min(1) });

async function requireManageEvents(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await resolveMobileAdminCapabilities(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageEvents")) {
    throw new MobileForbiddenError("No mobile event administration access for this organization");
  }
  return { userId, email };
}

/**
 * GET /api/mobile/admin/events/[eventId]?organizationId=...
 * PATCH /api/mobile/admin/events/[eventId]
 * Cancellation is just PATCH { status: "cancelled" } -- there is no
 * dedicated cancel route on the web side either (see CancelEventButton).
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageEvents(request, organizationId);
    const { eventId } = await params;

    const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) {
      return Response.json({ ok: false, error: "Event not found" }, { status: 404 });
    }

    return Response.json({ ok: true, data: event });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:events:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, updateMobileEventSchema);
    const { userId, email } = await requireManageEvents(request, organizationId);
    const { eventId } = await params;

    const result = await updateEvent(organizationId, { userId, userEmail: email }, eventId, input);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error }, { status: result.status });
    }

    return Response.json({ ok: true, data: result.data });
  });
}
