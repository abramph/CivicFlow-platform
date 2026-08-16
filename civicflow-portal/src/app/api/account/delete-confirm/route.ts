import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { consumeToken } from "@/lib/auth-tokens";
import { deleteUserAccount } from "@/lib/account-deletion";

const confirmSchema = z.object({
  token: z.string().min(1),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, confirmSchema);
    const result = await consumeToken(input.token, "account_deletion");
    if (!result.ok) {
      throw new ValidationError(result.error);
    }

    // A sole-org-owner block (thrown as AccountDeletionError) propagates to
    // withApiErrorHandling and surfaces plainly — the person confirming via
    // emailed link has already proven control of the inbox, equivalent to
    // an identity check, so telling them exactly which org(s) block
    // deletion here is useful, not a leak.
    const outcome = await deleteUserAccount({ userId: result.userId });
    return Response.json({ ok: true, result: outcome });
  });
}
