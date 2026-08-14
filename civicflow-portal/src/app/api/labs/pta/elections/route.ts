import { withApiErrorHandling } from "@/lib/api-route";
import { requirePtaAccess } from "@/lib/labs/pta/guard";
import { createElection, listElections } from "@/lib/labs/pta/elections";
import { parseJsonBody, z } from "@/lib/validation";

export async function GET() {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePtaAccess("pta:elections:view");
    const elections = await listElections(organizationId);
    return Response.json({ ok: true, data: elections });
  });
}

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  mode: z.enum(["OPEN", "SECRET_BALLOT"]).optional(),
  eligibilityNote: z.string().max(2000).nullable().optional(),
  votingOpensAt: z.coerce.date().nullable().optional(),
  votingClosesAt: z.coerce.date().nullable().optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePtaAccess("pta:elections:manage");
    const input = await parseJsonBody(request, createSchema);
    const election = await createElection({
      organizationId,
      ...input,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: election }, { status: 201 });
  });
}
