import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addContest, ensureElectionsEnabled } from "@/lib/labs/pta/elections";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  title: z.string().min(1).max(200),
  positionId: z.string().max(64).nullable().optional(),
  seats: z.number().int().min(1).max(20).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ electionId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:elections:manage");
    await ensureElectionsEnabled(organizationId);
    const { electionId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const contest = await addContest({
      organizationId,
      electionId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: contest }, { status: 201 });
  });
}
