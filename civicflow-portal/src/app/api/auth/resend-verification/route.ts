import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, z } from "@/lib/validation";
import { createEmailVerificationToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/mail";

const resendSchema = z.object({
  email: z.string().trim().email().max(254),
});

function appBaseUrl(): string {
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

// Always return the same response — never reveal whether the email exists or is already verified.
const OK_RESPONSE = Response.json({
  ok: true,
  message: "If that email is registered and awaiting verification, a new link has been sent.",
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, resendSchema);
    const email = input.email.toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified) return OK_RESPONSE;

    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${appBaseUrl()}/verify-email?token=${token}`;
    await sendVerificationEmail({ to: email, verifyUrl });

    return OK_RESPONSE;
  });
}
