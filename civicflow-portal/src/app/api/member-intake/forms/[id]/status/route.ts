import { withApiErrorHandling } from "@/lib/api-route";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";
import { requireMemberIntakePublish, publishIntakeForm, pauseIntakeForm, resumeIntakeForm, archiveIntakeForm } from "@/lib/member-intake/forms";

const bodySchema = z.object({ action: z.enum(["publish", "pause", "resume", "archive"]) });

const ACTIONS = { publish: publishIntakeForm, pause: pauseIntakeForm, resume: resumeIntakeForm, archive: archiveIntakeForm };

/** One dispatch route for every lifecycle transition (DRAFT/ACTIVE/PAUSED/
 * ARCHIVED) -- the state machine itself lives in forms.ts's
 * transitionFormStatus, which is what actually rejects an illegal move. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:member-intake:forms:write", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, session } = await requireMemberIntakePublish();
    const { id } = await params;
    const { action } = await parseJsonBody(request, bodySchema);

    const form = await ACTIONS[action](organizationId, id, session.userId);
    return Response.json({ ok: true, data: form });
  });
}
