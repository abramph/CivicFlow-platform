import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { getEffectiveTwilioCredentials } from "@/lib/sms-credentials";

/**
 * POST: verifies the currently-configured Twilio credentials by fetching
 * the account (and, if set, the Messaging Service) directly from Twilio's
 * API. Read-only — does not send any SMS.
 */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");

    const credentials = await getEffectiveTwilioCredentials();
    if (!credentials) {
      return Response.json({ ok: true, data: { success: false, error: "No Twilio credentials are configured." } });
    }

    const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64");
    const authHeader = { Authorization: `Basic ${basicAuth}` };

    let result: { success: boolean; error?: string; accountFriendlyName?: string; accountStatus?: string; messagingServiceFriendlyName?: string };

    try {
      const accountResponse = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
        { headers: authHeader }
      );
      const accountPayload = (await accountResponse.json().catch(() => null)) as
        | { friendly_name?: string; status?: string; message?: string }
        | null;

      if (!accountResponse.ok) {
        result = { success: false, error: accountPayload?.message ?? `Twilio account lookup failed (${accountResponse.status})` };
      } else {
        result = {
          success: true,
          accountFriendlyName: accountPayload?.friendly_name,
          accountStatus: accountPayload?.status,
        };

        if (credentials.messagingServiceSid) {
          const msResponse = await fetch(
            `https://messaging.twilio.com/v1/Services/${credentials.messagingServiceSid}`,
            { headers: authHeader }
          );
          const msPayload = (await msResponse.json().catch(() => null)) as
            | { friendly_name?: string; message?: string }
            | null;
          if (!msResponse.ok) {
            result = { ...result, success: false, error: msPayload?.message ?? `Messaging Service lookup failed (${msResponse.status})` };
          } else {
            result.messagingServiceFriendlyName = msPayload?.friendly_name;
          }
        }
      }
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : "Unknown connection error" };
    }

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.test_connection",
      entityType: "PlatformSmsSettings",
      metadata: { success: result.success, source: credentials.source },
    });

    return Response.json({ ok: true, data: result });
  });
}
