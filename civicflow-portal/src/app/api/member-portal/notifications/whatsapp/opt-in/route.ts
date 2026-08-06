import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { normalizeToE164 } from "@/lib/phone";
import { getClientIp, requireRateLimit } from "@/lib/rate-limit";
import { recordWhatsAppOptIn } from "@/lib/whatsapp-consent";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  phone: z.string().trim().min(1),
  // "SELF_SERVICE" from Notification Settings — no other entry point exists
  // yet (no /whatsapp-opt-in landing page/QR flow, unlike SMS's).
  consentAccepted: z.literal(true),
});

/**
 * Records WhatsApp consent directly — no OTP verification step (unlike SMS),
 * matching real-world WhatsApp business-messaging opt-in practice: a
 * checkbox consent, not phone-ownership proof. Building phone verification
 * here would require a Meta-approved AUTHENTICATION template, which doesn't
 * exist yet and is outside any PR's control (the account owner must submit
 * and get one approved first).
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, phone } = await parseJsonBody(request, bodySchema);
    const { userId, memberId } = await requireMemberWebSession(organizationId);

    const rateLimited = await requireRateLimit({
      scope: `member-whatsapp-optin:${userId}`,
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const normalizedPhone = normalizeToE164(phone);
    if (!normalizedPhone) {
      throw new ValidationError("Enter a valid phone number.");
    }

    await recordWhatsAppOptIn({
      organizationId,
      memberId,
      phone: normalizedPhone,
      ip: getClientIp(request),
      source: "SELF_SERVICE",
      actorUserId: userId,
    });

    return Response.json({ ok: true });
  });
}
