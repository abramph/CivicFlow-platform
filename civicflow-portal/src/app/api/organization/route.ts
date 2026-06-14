import { requirePermission } from "@/lib/auth-guards";
import { withApiErrorHandling } from "@/lib/api-route";
import { createAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { parseJsonBody, z } from "@/lib/validation";

const optionalTextField = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.literal(""), z.null()]).optional();

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(120).optional(),
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
  currency: optionalTextField(12),
  fiscalYearStart: z.number().int().min(1).max(12).optional(),
  emailFrom: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional(),
  customDomain: optionalTextField(255),
});

export async function GET() {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:read", "throw");

    const [organization, settings, categoryCounts, duesAccountCount] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
      }),
      prisma.orgSettings.findUnique({
        where: { organizationId },
      }),
      prisma.category.groupBy({
        by: ["type"],
        where: { organizationId },
        _count: { id: true },
      }),
      prisma.duesAccount.count({
        where: { organizationId },
      }),
    ]);

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "read",
      entityType: "organization_settings",
    });

    return Response.json({
      ok: true,
      data: {
        organization,
        settings,
        categoryCounts,
        duesAccountCount,
      },
    });
  });
}

export async function PATCH(request: Request) {
  return withApiErrorHandling(async () => {
    const { session, organizationId } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, updateOrganizationSchema);

    const existingOrg = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!existingOrg) {
      return Response.json({ ok: false, error: "Organization not found" }, { status: 404 });
    }

    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug.trim() } : {}),
        ...(input.organizationType !== undefined
          ? { organizationType: normalizeOptionalText(input.organizationType) }
          : {}),
        ...(input.email !== undefined ? { email: normalizeOptionalText(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: normalizeOptionalText(input.phone) } : {}),
        ...(input.website !== undefined ? { website: normalizeOptionalText(input.website) } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: normalizeOptionalText(input.logoUrl) } : {}),
        ...(input.addressLine1 !== undefined
          ? {
              addressLine1: normalizeOptionalText(input.addressLine1),
              address: normalizeOptionalText(input.addressLine1),
            }
          : {}),
        ...(input.addressLine2 !== undefined
          ? { addressLine2: normalizeOptionalText(input.addressLine2) }
          : {}),
        ...(input.city !== undefined ? { city: normalizeOptionalText(input.city) } : {}),
        ...(input.state !== undefined ? { state: normalizeOptionalText(input.state) } : {}),
        ...(input.zipCode !== undefined ? { zipCode: normalizeOptionalText(input.zipCode) } : {}),
        ...(input.country !== undefined ? { country: normalizeOptionalText(input.country) } : {}),
      },
    });

    const settings = await prisma.orgSettings.upsert({
      where: { organizationId },
      update: {
        ...(input.timezone !== undefined ? { timezone: normalizeOptionalText(input.timezone) ?? "America/New_York" } : {}),
        ...(input.currency !== undefined ? { currency: normalizeOptionalText(input.currency) ?? "USD" } : {}),
        ...(input.fiscalYearStart !== undefined ? { fiscalYearStart: input.fiscalYearStart } : {}),
        ...(input.emailFrom !== undefined ? { emailFrom: normalizeOptionalText(input.emailFrom) } : {}),
        ...(input.customDomain !== undefined ? { customDomain: normalizeOptionalText(input.customDomain) } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: normalizeOptionalText(input.logoUrl) } : {}),
      },
      create: {
        organizationId,
        timezone: normalizeOptionalText(input.timezone) ?? "America/New_York",
        currency: normalizeOptionalText(input.currency) ?? "USD",
        fiscalYearStart: input.fiscalYearStart ?? 1,
        emailFrom: normalizeOptionalText(input.emailFrom) ?? null,
        customDomain: normalizeOptionalText(input.customDomain) ?? null,
        logoUrl: normalizeOptionalText(input.logoUrl) ?? null,
      },
    });

    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "update",
      entityType: "organization_settings",
      metadata: {
        before: {
          name: existingOrg.name,
          slug: existingOrg.slug,
        },
        after: {
          name: organization.name,
          slug: organization.slug,
        },
      },
    });

    return Response.json({ ok: true, data: { organization, settings } });
  });
}
