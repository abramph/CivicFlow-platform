import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaHouseholdSelfAccess } from "@/lib/labs/pta/guard";
import { castVote } from "@/lib/labs/pta/elections";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  choices: z.array(z.object({ contestId: z.string().min(1).max(64), candidateId: z.string().min(1).max(64) })).min(1).max(60),
});

/** POST — cast the caller's own ballot. Linkage-gated; all secrecy and
 * eligibility rules live in castVote (see elections.ts invariants). */
export async function POST(request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  const limited = await requireRateLimit({ scope: "api:pta:elections:vote", request, limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  return withApiErrorHandling(async () => {
    const { organizationId, session, adult } = await requirePtaHouseholdSelfAccess();
    const { electionId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const result = await castVote({
      organizationId,
      electionId,
      householdAdultId: adult.id,
      choices: input.choices,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: result });
  });
}
