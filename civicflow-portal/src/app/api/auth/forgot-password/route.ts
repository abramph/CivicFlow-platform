import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { createPasswordResetToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/mail";

const forgotSchema = z.object({
  email: z.string().trim().email().max(254),
});

function appBaseUrl(): string {
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

// Always return an equivalent response — never reveal whether the email
// exists. Built fresh per request: a `Response` body is a single-use
// stream, so a shared module-level instance would come back empty on
// every call after the first.
function okResponse() {
  return Response.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, forgotSchema);
    const email = input.email.toLowerCase();
    console.log(JSON.stringify({ event: "password_reset_requested" }));

    const user = await prisma.user.findUnique({ where: { email } });
    console.log(JSON.stringify({ event: "account_match_found", found: !!user }));
    if (!user) return okResponse();

    const token = await createPasswordResetToken(user.id);
    console.log(JSON.stringify({ event: "reset_token_created", userId: user.id }));
    const resetUrl = `${appBaseUrl()}/reset-password?token=${token}`;

    // A transient SMTP/provider failure here must never surface as a 500 to
    // the user — that would both leak that the email exists (a real 500 vs.
    // the generic success response) and give no useful recovery action
    // besides "try again". Log it for our own alerting/diagnosis and still
    // return the same success response; the user can always request another
    // link if the email genuinely never arrives.
    try {
      await sendPasswordResetEmail({ to: email, resetUrl });
    } catch (error) {
      Sentry.captureException(error);
      console.error("[forgot-password] Failed to send password reset email:", error);
    }

    return okResponse();
  });
}
