import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { recordOfflineContribution, OFFLINE_METHODS } from "@/lib/giving/offline";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  fundId: z.string().min(1).max(64),
  amount: z.number().positive().max(1_000_000),
  method: z.enum(OFFLINE_METHODS as [string, ...string[]]),
  contributionDate: z.coerce.date(),
  memberId: z.string().max(64).nullable().optional(),
  contributorName: z.string().max(200).nullable().optional(),
  anonymous: z.boolean().optional(),
  reference: z.string().max(120).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  pledgeId: z.string().max(64).nullable().optional(),
  programId: z.string().max(64).nullable().optional(),
});

/** CORE-GIVE-F — record a cash/check/offline contribution (§21). Requires
 * contributions:offline:create; every entry is audited. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("contributions:offline:create", "throw");
    const input = await parseJsonBody(request, bodySchema);
    const contribution = await recordOfflineContribution({
      organizationId,
      ...input,
      method: input.method as (typeof OFFLINE_METHODS)[number],
      actorUserId: session.userId,
      actorEmail: session.userEmail,
    });
    return Response.json({ ok: true, data: contribution }, { status: 201 });
  });
}
