import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { createMeetingIntelligenceJob } from "@/lib/labs/meeting-intelligence/jobs";
import { parseJsonBody, z } from "@/lib/validation";

const consentSchema = z.object({
  participantsNotifiedOrConsented: z.literal(true),
  uploaderAuthorized: z.literal(true),
  mayContainSensitiveInformation: z.literal(true),
  aiRequiresHumanVerification: z.literal(true),
  organizationResponsibleForRetention: z.literal(true),
});

const createJobSchema = z.object({
  meetingId: z.string().min(1),
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
  consent: consentSchema,
});

export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requireMeetingIntelligenceAccess("meetingIntelligence:read");
    const { searchParams } = new URL(request.url);
    const meetingId = searchParams.get("meetingId");

    const jobs = await prisma.meetingIntelligenceJob.findMany({
      where: { organizationId, ...(meetingId ? { meetingId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        meetingId: true,
        status: true,
        provider: true,
        originalFilename: true,
        fileSizeBytes: true,
        audioDurationSeconds: true,
        failureCode: true,
        failureMessage: true,
        createdAt: true,
        submittedAt: true,
        transcribedAt: true,
        minutesGeneratedAt: true,
        completedAt: true,
        failedAt: true,
      },
    });

    return Response.json({ ok: true, data: jobs });
  });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:create");
    const input = await parseJsonBody(request, createJobSchema);

    const job = await createMeetingIntelligenceJob({
      organizationId,
      meetingId: input.meetingId,
      uploadedByUserId: session.userId,
      uploadedByUserEmail: session.userEmail,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      consent: input.consent,
    });
    return Response.json({ ok: true, data: job }, { status: 201 });
  });
}
