import { withApiErrorHandling } from "@/lib/api-route";
import { requireMemberWebSession } from "@/lib/member-web-session";
import { getClientIp, requireRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { recordSmsOptIn } from "@/lib/sms-consent";
import { hashOtpCode } from "@/lib/sms-otp";
import { parseJsonBody, z } from "@/lib/validation";

const bodySchema = z.object({
  organizationId: z.string().min(1),
  code: z.string().trim().min(1),
  // "PROFILE_SETTINGS" from Notification Settings, "QR_CODE" from the public
  // /sms-opt-in landing page — same confirm endpoint serves both entry points.
  method: z.enum(["PROFILE_SETTINGS", "QR_CODE"]).optional(),
});

/** Confirms the code sent by /send-code and, on success, records SMS consent. */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, code, method } = await parseJsonBody(request, bodySchema);
    const { userId, memberId } = await requireMemberWebSession(organizationId);

    const rateLimited = await requireRateLimit({
      scope: `member-sms-optin-confirm:${userId}`,
      request,
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (rateLimited) return rateLimited;

    const record = await prisma.mfaChallengeToken.findFirst({
      where: { userId, type: "sms_opt_in" },
      orderBy: { createdAt: "desc" },
    });

    if (!record || !record.phone || !record.codeHash || record.expiresAt < new Date()) {
      return Response.json({ ok: false, error: "Verification code expired. Request a new one." }, { status: 400 });
    }

    if (hashOtpCode(code.trim().replace(/\s/g, "")) !== record.codeHash) {
      return Response.json({ ok: false, error: "Invalid code. Please try again." }, { status: 400 });
    }

    await recordSmsOptIn({
      organizationId,
      memberId,
      phone: record.phone,
      ip: getClientIp(request),
      method: method ?? "PROFILE_SETTINGS",
      actorUserId: userId,
    });

    await prisma.mfaChallengeToken.delete({ where: { id: record.id } });

    return Response.json({ ok: true });
  });
}
