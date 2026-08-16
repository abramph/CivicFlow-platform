import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { createAccountDeletionToken } from "@/lib/auth-tokens";
import { sendAccountDeletionEmail } from "@/lib/mail";

/**
 * Public, unauthenticated account-deletion request — for a user who needs
 * to delete their account without app/portal access. Deliberately mirrors
 * /api/auth/forgot-password exactly: same "always return an equivalent
 * response" shape so this endpoint can never be used to test whether a
 * given email is a registered Unestra account.
 */
const requestSchema = z.object({
  email: z.string().trim().email().max(254),
});

function appBaseUrl(): string {
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

function okResponse() {
  return Response.json({ ok: true, message: "If that email is registered, we've sent a confirmation link." });
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, requestSchema);
    const email = input.email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, deletedAt: true } });
    // An already-deleted account behaves identically to a non-existent one
    // here — never a distinguishable response either way.
    if (!user || user.deletedAt) return okResponse();

    const token = await createAccountDeletionToken(user.id);
    const confirmUrl = `${appBaseUrl()}/delete-account/confirm?token=${token}`;

    try {
      await sendAccountDeletionEmail({ to: email, confirmUrl });
    } catch (error) {
      Sentry.captureException(error);
      console.error("[delete-request] Failed to send account deletion email:", error);
    }

    return okResponse();
  });
}
