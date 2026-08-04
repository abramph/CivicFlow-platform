import { withApiErrorHandling } from "@/lib/api-route";
import { requireHoaViolationWrite } from "@/lib/hoa/violations-guard";
import { addViolationComment } from "@/lib/hoa/violations";
import { parseJsonBody, z } from "@/lib/validation";

const commentSchema = z.object({
  body: z.string().min(1).max(3000),
  // Defaults to true (private/board-only) -- a caller must explicitly opt
  // in to a resident-visible comment, matching the schema-level default on
  // ViolationComment.isPrivate. Never the other way around.
  isPrivate: z.boolean().default(true),
});

export async function POST(request: Request, { params }: { params: Promise<{ violationId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireHoaViolationWrite();
    const { violationId } = await params;
    const input = await parseJsonBody(request, commentSchema);
    const comment = await addViolationComment({
      organizationId,
      violationId,
      body: input.body,
      isPrivate: input.isPrivate ?? true,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: comment }, { status: 201 });
  });
}
