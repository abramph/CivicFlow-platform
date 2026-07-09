import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { getMaskedSmsCredentialsView, updatePlatformSmsCredentials } from "@/lib/sms-credentials";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  accountSid: z.string().min(1).nullable().optional(),
  authToken: z.string().min(1).nullable().optional(),
  apiKey: z.string().min(1).nullable().optional(),
  apiSecret: z.string().min(1).nullable().optional(),
  messagingServiceSid: z.string().min(1).nullable().optional(),
  tollFreeNumber: z.string().min(1).nullable().optional(),
  verifyServiceSid: z.string().min(1).nullable().optional(),
});

/**
 * PUT: encrypts and saves Twilio credentials. Never echoes plaintext back —
 * the response is the same masked view GET /settings returns.
 */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");
    const input = await parseJsonBody(request, bodySchema);

    await updatePlatformSmsCredentials(input, session.userId);

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.credentials_updated",
      entityType: "PlatformSmsSettings",
      // Only record which fields changed, never the values themselves.
      metadata: { fieldsUpdated: Object.keys(input) },
    });

    return Response.json({ ok: true, data: await getMaskedSmsCredentialsView() });
  });
}
