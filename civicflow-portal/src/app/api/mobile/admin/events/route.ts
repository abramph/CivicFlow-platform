import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";
import { createEvent, createEventSchema } from "@/lib/event-mutations";
import { getAdminEventRsvpCounts } from "@/lib/event-rsvp";

const createMobileEventSchema = createEventSchema.extend({ organizationId: z.string().min(1) });

async function requireManageEvents(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await requireMobileAdminAccess(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageEvents")) {
    throw new MobileForbiddenError("No mobile event administration access for this organization");
  }
  return { userId, email };
}

/**
 * GET /api/mobile/admin/events?organizationId=...
 * POST /api/mobile/admin/events
 * Mirrors the web /events list + create exactly (src/app/api/events/route.ts),
 * delegating writes to the shared createEvent() (src/lib/event-mutations.ts).
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageEvents(request, organizationId);

    const rows = await prisma.event.findMany({
      where: { organizationId },
      orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, title: true, location: true, startAt: true, endAt: true, status: true },
    });

    // Compact per-row planning summary (one batched groupBy, no N+1) —
    // additive field, so fielded clients that predate it are unaffected.
    // null means the org's RSVP mode is "none" (HOA); a present object with
    // zero totalResponses means "no responses yet".
    const counts = await getAdminEventRsvpCounts(organizationId, rows.map((row) => row.id));
    const data = rows.map((row) => ({
      ...row,
      rsvp:
        counts.mode === "none"
          ? null
          : {
              guestCounts: counts.guestCounts,
              ...(counts.byId[row.id] ?? { totalResponses: 0, going: 0, maybe: 0, notGoing: 0, totalAttendees: 0 }),
            },
    }));

    return Response.json({ ok: true, data });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:mobile:admin:events:write",
      request,
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, ...input } = await parseJsonBody(request, createMobileEventSchema);
    const { userId, email } = await requireManageEvents(request, organizationId);

    const row = await createEvent(organizationId, { userId, userEmail: email }, input);

    return Response.json({ ok: true, data: row }, { status: 201 });
  });
}
