import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { resolveCommunicationRecipients } from "@/lib/communication-campaigns";

const bodySchema = z.object({
  recipientFilter: z.record(z.string(), z.unknown()),
  channel: z.enum(["EMAIL", "SMS", "EMAIL_AND_SMS", "INTERNAL_LOG_ONLY"]),
});

/**
 * Read-only recipient-count preview for the campaign creation form — never
 * persists anything. Calls the exact same resolveCommunicationRecipients()
 * the real create flow uses, so the previewed count is guaranteed to match
 * what a real campaign created with this same filter would actually get;
 * no separate estimate logic to keep in sync.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId } = await requirePermission("communications:write", "throw");
    const input = await parseJsonBody(request, bodySchema);
    const recipients = await resolveCommunicationRecipients(organizationId, input.recipientFilter, input.channel);
    return Response.json({ ok: true, data: { count: recipients.length } });
  });
}
