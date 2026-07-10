import { requireSuperAdmin } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getEffectiveTwilioCredentials, getPlatformSmsSettings } from "@/lib/sms-credentials";

/**
 * Twilio's toll-free verification status values, mapped to our simpler
 * TollFreeVerificationStatus enum. Unestra only displays/refreshes status
 * here — submitting a new verification happens in the Twilio Console.
 */
const STATUS_MAP: Record<string, "PENDING" | "VERIFIED" | "REJECTED"> = {
  "pending-review": "PENDING",
  "in-review": "PENDING",
  "twilio-approved": "VERIFIED",
  "twilio-rejected": "REJECTED",
};

/** POST: refreshes toll-free verification status from Twilio, using the verification SID already on file. */
export async function POST() {
  return withApiErrorHandling(async () => {
    const { session } = await requireSuperAdmin("throw");

    const settings = await getPlatformSmsSettings();
    if (!settings.tollFreeVerificationSid) {
      return Response.json(
        { ok: false, error: "No toll-free verification SID is on file. Submit verification in the Twilio Console first." },
        { status: 400 }
      );
    }

    const credentials = await getEffectiveTwilioCredentials();
    if (!credentials) {
      return Response.json({ ok: false, error: "No Twilio credentials are configured." }, { status: 400 });
    }

    const basicAuth = Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64");

    const response = await fetch(
      `https://messaging.twilio.com/v1/Tollfree/Verifications/${settings.tollFreeVerificationSid}`,
      { headers: { Authorization: `Basic ${basicAuth}` } }
    );
    const payload = (await response.json().catch(() => null)) as { status?: string; message?: string } | null;

    if (!response.ok) {
      return Response.json(
        { ok: false, error: payload?.message ?? `Twilio verification lookup failed (${response.status})` },
        { status: 502 }
      );
    }

    const mappedStatus = STATUS_MAP[payload?.status ?? ""] ?? "PENDING";
    const now = new Date();

    const updated = await prisma.platformSmsSettings.update({
      where: { id: settings.id },
      data: {
        tollFreeVerificationStatus: mappedStatus,
        tollFreeVerificationLastCheckedAt: now,
        ...(mappedStatus === "VERIFIED" && !settings.tollFreeVerificationApprovedAt
          ? { tollFreeVerificationApprovedAt: now }
          : {}),
      },
    });

    await createAuditEvent({
      organizationId: null,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "sms_admin.toll_free_verification_refreshed",
      entityType: "PlatformSmsSettings",
      metadata: { status: mappedStatus },
    });

    return Response.json({
      ok: true,
      data: {
        status: updated.tollFreeVerificationStatus,
        lastCheckedAt: updated.tollFreeVerificationLastCheckedAt,
        approvedAt: updated.tollFreeVerificationApprovedAt,
      },
    });
  });
}
