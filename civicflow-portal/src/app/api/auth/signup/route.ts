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
  orgName: z.string().trim().min(1, "Organization name is required").max(200),
});

function appBaseUrl(): string {
  return String(process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "org"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  const slug = slugify(base);
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (!existing) return slug;
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug.slice(0, 45)}-${suffix}`;
}

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const input = await parseJsonBody(request, signupSchema);
    const email = input.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationError("An account with this email already exists.");
    }

    const [passwordHash, slug] = await Promise.all([
      bcrypt.hash(input.password, 12),
      uniqueSlug(input.orgName),
    ]);

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email,
          displayName: input.displayName?.trim() || null,
          passwordHash,
          emailVerified: false,
        },
      });
      const org = await tx.organization.create({
        data: { name: input.orgName, slug, plan: "free", trialEndsAt, status: "active" },
      });
      await tx.organizationMembership.create({
        data: { userId: newUser.id, organizationId: org.id, role: "ORG_OWNER" },
      });
      await tx.orgSettings.create({ data: { organizationId: org.id } });
      return newUser;
    });

    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${appBaseUrl()}/verify-email?token=${token}`;
    await sendVerificationEmail({ to: email, verifyUrl });

    return Response.json({ ok: true, message: "Account created. Check your email to verify." }, { status: 201 });
  });
}
