import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/api-route";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";
import { createEmailVerificationToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/mail";

const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(100).optional(),
});

function appBaseUrl(): string {
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Creates the personal account only — no organization. An organization
 * (with its immutable primaryVertical) is created separately, after login,
 * via /onboarding/organization: see docs/vertical-organization-onboarding.md.
 * This used to create an Organization + OrganizationMembership + OrgSettings
 * inline here, which meant every signup silently defaulted to the
 * COMMUNITY vertical without ever asking — the exact thing PR #39 fixes.
 */
export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, signupSchema);
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationError("An account with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        displayName: input.displayName?.trim() || null,
        passwordHash,
        emailVerified: false,
      },
    });

    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${appBaseUrl()}/verify-email?token=${token}`;
    await sendVerificationEmail({ to: email, verifyUrl });

    return Response.json({ ok: true, message: "Account created. Check your email to verify." }, { status: 201 });
  });
}
