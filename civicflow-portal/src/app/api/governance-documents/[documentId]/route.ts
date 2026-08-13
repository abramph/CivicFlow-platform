import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { setGovernanceDocumentStatus } from "@/lib/governance-documents";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  // SUPERSEDED is deliberately absent — it is only ever set automatically
  // when another version becomes CURRENT.
  status: z.enum(["DRAFT", "CURRENT", "ARCHIVED"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("governance:write", "throw");
    const { documentId } = await params;
    const input = await parseJsonBody(request, bodySchema);
    const document = await setGovernanceDocumentStatus({
      organizationId,
      documentId,
      status: input.status,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: document });
  });
}
