import { withApiErrorHandling } from "@/lib/api-route";
import { requireArchitecturalRequestReview } from "@/lib/hoa/architectural-requests-guard";
import { addArchitecturalRequestComment } from "@/lib/hoa/architectural-requests";
import { parseJsonBody, z } from "@/lib/validation";

const commentSchema = z.object({
  body: z.string().min(1).max(3000),
  // Defaults to true (private/board-committee-only) -- a caller must
  // explicitly opt in to a resident-visible comment, matching the
  // schema-level default on ArchitecturalRequestComment.isPrivate.
  isPrivate: z.boolean().default(true),
});

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requireArchitecturalRequestReview();
    const { requestId } = await params;
    const input = await parseJsonBody(request, commentSchema);
    const comment = await addArchitecturalRequestComment({
      organizationId,
      requestId,
      body: input.body,
      isPrivate: input.isPrivate ?? true,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: comment }, { status: 201 });
  });
}
