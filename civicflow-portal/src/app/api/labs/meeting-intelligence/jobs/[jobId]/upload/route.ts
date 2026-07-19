import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { uploadMeetingIntelligenceRecording } from "@/lib/labs/meeting-intelligence/jobs";
import { ValidationError } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({
      scope: "api:labs:meeting-intelligence:upload",
      request,
      limit: 10,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMeetingIntelligenceAccess("meetingIntelligence:create");
    const { jobId } = await params;

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return Response.json({ ok: false, error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`, code: "MEETING_INTELLIGENCE_FILE_TOO_LARGE" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) throw new ValidationError("No file uploaded.");

    const buffer = Buffer.from(await file.arrayBuffer());

    // Audio duration is not known from file size alone — no estimate is
    // fabricated here. recordAudioMinutesUploaded() is called later, once
    // the transcription provider reports the real duration (see worker.ts),
    // using an accurate value rather than a guess derived from bytes.
    const job = await uploadMeetingIntelligenceRecording({
      organizationId,
      jobId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      originalFilename: file.name,
      mimeType: file.type,
      buffer,
    });

    return Response.json({ ok: true, data: job });
  });
}
