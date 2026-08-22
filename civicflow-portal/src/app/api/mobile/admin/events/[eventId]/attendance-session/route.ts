import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { ValidationError, parseJsonBody, z } from "@/lib/validation";

const createSchema = z.object({
  organizationId: z.string().min(1),
  mode: z.enum(["ROTATING_QR", "STATIC_QR"]).default("ROTATING_QR"),
  opensAt: z.union([z.string().datetime(), z.null()]).optional(),
  closesAt: z.union([z.string().datetime(), z.null()]).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(180).optional(),
  rotationSeconds: z.number().int().min(5).max(300).optional(),
});

async function requireManageAttendance(request: Request, organizationId: string) {
  const { userId, email } = await requireMobileAuth(request);
  const admin = await requireMobileAdminAccess(organizationId, userId);
  if (!admin.available || !admin.adminCapabilities.includes("manageAttendance")) {
    throw new MobileForbiddenError("No mobile attendance administration access for this organization");
  }
  return { userId, email };
}

/**
 * GET /api/mobile/admin/events/[eventId]/attendance-session?organizationId=...
 * POST /api/mobile/admin/events/[eventId]/attendance-session
 * Mirrors src/app/api/events/[id]/attendance-session/route.ts exactly --
 * same "reuse an existing DRAFT/OPEN session" idempotency, same
 * startAt-required precondition.
 */
export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    await requireManageAttendance(request, organizationId);
    const { eventId } = await params;

    const session = await prisma.meetingAttendanceSession.findFirst({
      where: { organizationId, eventId },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ ok: true, data: session });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, ...input } = await parseJsonBody(request, createSchema);
    const { userId, email } = await requireManageAttendance(request, organizationId);
    const { eventId } = await params;

    const event = await prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) return Response.json({ ok: false, error: "Event not found" }, { status: 404 });
    if (!event.startAt) {
      return Response.json(
        { ok: false, error: "This event has no scheduled start time yet. Set one before starting QR attendance." },
        { status: 400 }
      );
    }

    const existing = await prisma.meetingAttendanceSession.findFirst({
      where: { organizationId, eventId, status: { in: ["DRAFT", "OPEN"] } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return Response.json({ ok: true, data: existing });

    const created = await prisma.meetingAttendanceSession.create({
      data: {
        organizationId,
        eventId,
        mode: input.mode,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        lateThresholdMinutes: input.lateThresholdMinutes ?? 10,
        rotationSeconds: input.rotationSeconds ?? 30,
        createdByUserId: userId,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: userId,
      actorEmail: email,
      action: "create",
      entityType: "meeting_attendance_session",
      entityId: created.id,
      metadata: { eventId, mode: created.mode },
    });

    return Response.json({ ok: true, data: created }, { status: 201 });
  });
}
