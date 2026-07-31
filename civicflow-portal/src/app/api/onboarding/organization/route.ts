import { requireAuth } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { defaultPaymentMethods } from "@/lib/payment-methods";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, ValidationError, z } from "@/lib/validation";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(120),
  primaryVertical: z.enum(["COMMUNITY", "PTA", "UNION", "HOA"]),
  organizationType: optionalTextField(120),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  phone: optionalTextField(50),
  website: optionalTextField(255),
  logoUrl: optionalTextField(500),
  addressLine1: optionalTextField(255),
  addressLine2: optionalTextField(255),
  city: optionalTextField(120),
  state: optionalTextField(120),
  zipCode: optionalTextField(30),
  country: optionalTextField(120),
  timezone: optionalTextField(80),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  defaultMembershipCategoryName: optionalTextField(160),
  defaultMembershipCategoryDescription: optionalTextField(4000),
  defaultDuesCategoryName: optionalTextField(160),
  defaultDuesAmount: z.number().nonnegative().nullable().optional(),
  defaultDuesFrequency: optionalTextField(40),
  seniorAgeThreshold: z.number().int().min(0).max(150).nullable().optional(),
  youthMaxAge: z.number().int().min(0).max(150).nullable().optional(),
  studentMaxAge: z.number().int().min(0).max(150).nullable().optional(),
  acceptedPaymentMethods: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  return withApiErrorHandling(async () => {
    const session = await requireAuth();
    const input = await parseJsonBody(request, createOrganizationSchema);

    const existingMembership = await prisma.organizationMembership.findFirst({
      where: { userId: session.userId },
      include: { organization: true },
    });

    if (existingMembership?.organization.status === "active") {
      throw new ValidationError("Your account already belongs to an active organization.");
    }

    const organization = await prisma.organization.create({
      data: {
        slug: input.slug.trim(),
        name: input.name.trim(),
        primaryVertical: input.primaryVertical,
        organizationType: normalizeOptionalText(input.organizationType) ?? null,
        email: normalizeOptionalText(input.email) ?? null,
        phone: normalizeOptionalText(input.phone) ?? null,
        website: normalizeOptionalText(input.website) ?? null,
        logoUrl: normalizeOptionalText(input.logoUrl) ?? null,
        address: normalizeOptionalText(input.addressLine1) ?? null,
        addressLine1: normalizeOptionalText(input.addressLine1) ?? null,
        addressLine2: normalizeOptionalText(input.addressLine2) ?? null,
        city: normalizeOptionalText(input.city) ?? null,
        state: normalizeOptionalText(input.state) ?? null,
        zipCode: normalizeOptionalText(input.zipCode) ?? null,
        country: normalizeOptionalText(input.country) ?? null,
        plan: "free",
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "active",
      },
    });

    await prisma.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: session.userId,
        role: "ORG_OWNER",
      },
    });

    await prisma.orgSettings.create({
      data: {
        organizationId: organization.id,
        timezone: normalizeOptionalText(input.timezone) ?? "America/New_York",
        currency: "USD",
        fiscalYearStart: input.fiscalYearStart ?? 1,
        logoUrl: normalizeOptionalText(input.logoUrl) ?? null,
        emailFrom: normalizeOptionalText(input.email) ?? null,
      },
    });

    let defaultDuesCategoryId: string | null = null;

    if (normalizeOptionalText(input.defaultDuesCategoryName)) {
      const duesCategory = await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: String(normalizeOptionalText(input.defaultDuesCategoryName)),
          type: "DUES",
          isActive: true,
          amountDefault: input.defaultDuesAmount ?? null,
          frequency: normalizeOptionalText(input.defaultDuesFrequency) ?? "monthly",
          notes: "Created during organization onboarding.",
        },
      });

      defaultDuesCategoryId = duesCategory.id;
    }

    if (normalizeOptionalText(input.defaultMembershipCategoryName)) {
      await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: String(normalizeOptionalText(input.defaultMembershipCategoryName)),
          type: "MEMBERSHIP",
          description: normalizeOptionalText(input.defaultMembershipCategoryDescription) ?? null,
          isActive: true,
          standardDuesCategoryId: defaultDuesCategoryId,
          notes: "Created during organization onboarding.",
        },
      });
    }

    if (input.seniorAgeThreshold !== null && input.seniorAgeThreshold !== undefined) {
      const seniorDues = await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: "Senior Free Dues",
          type: "DUES",
          isActive: true,
          amountDefault: 0,
          frequency: normalizeOptionalText(input.defaultDuesFrequency) ?? "monthly",
          notes: "Created during organization onboarding.",
        },
      });

      await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: "Elderly/Senior",
          type: "MEMBERSHIP",
          isActive: true,
          minAge: input.seniorAgeThreshold,
          autoAssignByAge: true,
          priority: 100,
          standardDuesCategoryId: seniorDues.id,
          notes: "Created during organization onboarding.",
        },
      });
    }

    if (input.youthMaxAge !== null && input.youthMaxAge !== undefined) {
      await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: "Youth",
          type: "MEMBERSHIP",
          isActive: true,
          minAge: 0,
          maxAge: input.youthMaxAge,
          autoAssignByAge: true,
          priority: 90,
          standardDuesCategoryId: defaultDuesCategoryId,
          notes: "Created during organization onboarding.",
        },
      });
    }

    if (input.studentMaxAge !== null && input.studentMaxAge !== undefined) {
      await prisma.category.create({
        data: {
          organizationId: organization.id,
          name: "Student",
          type: "MEMBERSHIP",
          isActive: true,
          minAge: 0,
          maxAge: input.studentMaxAge,
          autoAssignByAge: false,
          priority: 80,
          standardDuesCategoryId: defaultDuesCategoryId,
          notes: "Created during organization onboarding.",
        },
      });
    }

    const acceptedMethods = new Set(input.acceptedPaymentMethods ?? defaultPaymentMethods.map((method) => method.method));
    await prisma.paymentMethodConfig.createMany({
      data: defaultPaymentMethods.map((method) => ({
        organizationId: organization.id,
        method: method.method,
        label: method.label,
        sortOrder: method.sortOrder,
        isActive: acceptedMethods.has(method.method),
      })),
      skipDuplicates: true,
    });

    await createAuditEvent({
      organizationId: organization.id,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "create",
      entityType: "organization",
      entityId: organization.id,
      metadata: {
        slug: organization.slug,
        name: organization.name,
        primaryVertical: organization.primaryVertical,
      },
    });

    return Response.json({ ok: true, data: { id: organization.id, primaryVertical: organization.primaryVertical } }, { status: 201 });
  });
}
