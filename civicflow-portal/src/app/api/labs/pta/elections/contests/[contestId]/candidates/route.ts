import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { addCandidate, ensureElectionsEnabled } from "@/lib/labs/pta/elections";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  name: z.string().min(1).max(200),
  statement: z.string().max(4000).nullable().optional(),
  householdAdultId: z.string().max(64).nullable().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ contestId: string }> }) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:elections:manage");
    await ensureElectionsEnabled(organizationId);
    const { contestId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const candidate = await addCandidate({
      organizationId,
      contestId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: candidate }, { status: 201 });
  });
}
