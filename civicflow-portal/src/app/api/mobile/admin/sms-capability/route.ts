import { withApiErrorHandling } from "@/lib/api-route";
import { requireMobileAuth, MobileForbiddenError } from "@/lib/mobile-auth";
import { requireMobileAdminAccess } from "@/lib/mobile-admin";
import { ValidationError } from "@/lib/validation";
import { getMobileSmsCapability } from "@/lib/mobile-sms-capability";

/**
 * GET /api/mobile/admin/sms-capability?organizationId=...
 *
 * Read-only. Tells the mobile campaign composer whether it may offer SMS as a
 * channel for this org right now, derived live from the server's single SMS
 * entitlement source (getSmsEntitlement) and projected to the narrow,
 * non-sensitive MobileSmsCapability shape (see mobile-sms-capability.ts — never
 * any Stripe/Twilio/phone identifier).
 *
 * Guarded identically to POST /api/mobile/admin/campaigns: only a caller who
 * actually holds `manageCommunications` for this org — the same people who can
 * compose — may read it, so the capability read can never become a channel for
 * probing another org's billing posture.
 */
export async function GET(request: Request) {
  return withApiErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    if (!organizationId) throw new ValidationError("organizationId is required");

    const { userId } = await requireMobileAuth(request);
    const admin = await requireMobileAdminAccess(organizationId, userId);
    if (!admin.available || !admin.adminCapabilities.includes("manageCommunications")) {
      throw new MobileForbiddenError("No mobile communications administration access for this organization");
    }

    const capability = await getMobileSmsCapability(organizationId);
    return Response.json({ ok: true, data: capability });
  });
}
