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

// Always return the same response — never reveal whether the email exists.
const OK_RESPONSE = Response.json({ ok: true, message: "If that email is registered, a reset link has been sent." });

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, forgotSchema);
    const email = input.email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return OK_RESPONSE;

    const token = await createPasswordResetToken(user.id);
    const resetUrl = `${appBaseUrl()}/reset-password?token=${token}`;

    await sendPasswordResetEmail({ to: email, resetUrl });

    return OK_RESPONSE;
  });
}
