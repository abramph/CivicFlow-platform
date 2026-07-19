import { withApiErrorHandling } from "@/lib/api-route";
import { requireMeetingIntelligenceAccess } from "@/lib/labs/meeting-intelligence/guard";
import { uploadMeetingIntelligenceRecording } from "@/lib/labs/meeting-intelligence/jobs";
import { MAX_FILE_SIZE_BYTES } from "@/lib/labs/meeting-intelligence/upload-validation";
import { ValidationError } from "@/lib/validation";
import { requireRateLimit } from "@/lib/rate-limit";

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

    // Fast-fail on the declared Content-Length before ever buffering the
    // body — validateUploadedRecording() (called downstream) re-checks the
    // real byte length against the same MAX_FILE_SIZE_BYTES regardless, so
    // a spoofed/missing Content-Length can't bypass the limit, only skip
    // this early exit.
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      return Response.json({ ok: false, error: `File exceeds the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB limit.`, code: "MEETING_INTELLIGENCE_FILE_TOO_LARGE" }, { status: 400 });
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
