import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { resolveCommunicationRecipients } from "@/lib/communication-campaigns";
import { requireRateLimit } from "@/lib/rate-limit";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  recipientFilter: z.record(z.string(), z.unknown()),
  channel: z.enum(["EMAIL", "SMS", "EMAIL_AND_SMS", "INTERNAL_LOG_ONLY"]),
});

/**
 * POST /api/mobile/admin/campaigns/preview-recipients
 *
 * Build 27 — mobile mirror of the web preview route: read-only, persists
 * nothing, and calls the exact same resolveCommunicationRecipients() the
 * real create flow uses, so the previewed count always matches what a
 * campaign created with this filter would actually get. Same
 * manageCommunications gate as every other mobile campaign route.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const rateLimited = await requireRateLimit({ scope: "api:mobile:admin:campaigns:preview", request, limit: 30, windowMs: 60_000 });
    if (rateLimited) return rateLimited;

    const { organizationId, recipientFilter, channel } = await parseJsonBody(request, bodySchema);
    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }

    const recipients = await resolveCommunicationRecipients(organizationId, recipientFilter, channel);
    return Response.json({ ok: true, data: { count: recipients.length } });
  });
}
