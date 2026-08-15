import { withApiErrorHandling } from "@/lib/api-route";
import { requireUnionCaseNotesInternal, requireUnionCaseManage } from "@/lib/union/cases-guard";
import { addUnionCaseComment } from "@/lib/union/cases";
import { parseJsonBody, z } from "@/lib/validation";

const commentSchema = z.object({
  body: z.string().min(1).max(3000),
  // Defaults to true (internal/union-staff-only) -- a caller must
  // explicitly opt in to a member-visible comment, matching the
  // schema-level default on UnionCaseComment.isPrivate.
  isPrivate: z.boolean().default(true),
});

/**
 * Required permission depends on visibility, not just the route:
 * INTERNAL notes require union:cases:notes:internal (its own tier per the
 * program spec -- internal steward discussion is more sensitive than
 * ordinary case administration); a MEMBER_VISIBLE update only requires
 * union:cases:manage. Body is parsed before the guard runs, same reasoning
 * as the transition route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  return withApiErrorHandling(async () => {
    const { caseId } = await params;
    const input = await parseJsonBody(request, commentSchema);
    const isPrivate = input.isPrivate ?? true;

    const { organizationId, session } = isPrivate ? await requireUnionCaseNotesInternal() : await requireUnionCaseManage();

    const comment = await addUnionCaseComment({
      organizationId,
      caseId,
      body: input.body,
      isPrivate,
      actorUserId: session.userId,
    });
    return Response.json({ ok: true, data: comment }, { status: 201 });
  });
}
