import { withApiErrorHandling } from "@/lib/api-route";
import { requirePermission } from "@/lib/auth-guards";
import { CATEGORY_INFO, categoriesForVertical } from "@/lib/organization-category";
import { prisma } from "@/lib/prisma";
import { createAuditEvent } from "@/lib/audit";
import { parseJsonBody, z } from "@/lib/validation";

const putSchema = z.object({
  category: z.enum([
    "COMMUNITY",
    "PTA_PTO",
    "UNION",
    "HOA",
    "CHURCH_RELIGIOUS",
    "CULTURAL",
    "ALUMNI",
    "PROFESSIONAL_ASSOCIATION",
    "CIVIC_ASSOCIATION",
    "FRATERNAL",
    "CLUB",
    "NONPROFIT",
    "OTHER",
  ]),
  /** Apply the category's terminology presets (giving + member labels).
   * Explicit opt-in — choosing a category alone never rewrites labels. */
  applyPresets: z.boolean().optional(),
});

/** CORE-GIVE-I (§2/§3) — set the organization's presentation category.
 * The category must run on the organization's CURRENT experience vertical:
 * changing engines stays a Platform Admin primaryVertical operation. */
export async function PUT(request: Request) {
  return withApiErrorHandling(async () => {
    const { organizationId, session } = await requirePermission("org_settings:write", "throw");
    const input = await parseJsonBody(request, putSchema);

    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { primaryVertical: true, category: true },
    });
    if (!organization) return Response.json({ ok: false, error: "Organization not found." }, { status: 404 });
    if (!categoriesForVertical(organization.primaryVertical).includes(input.category)) {
      return Response.json(
        {
          ok: false,
          error: `That category runs on a different experience — contact support to change your organization's product experience.`,
        },
        { status: 422 }
      );
    }

    await prisma.organization.update({ where: { id: organizationId }, data: { category: input.category } });
    const info = CATEGORY_INFO[input.category];
    if (input.applyPresets) {
      await prisma.orgSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          contributionTerminology: info.givingTerminology,
          memberTerminology: info.memberLabel,
        },
        update: {
          contributionTerminology: info.givingTerminology,
          memberTerminology: info.memberLabel,
        },
      });
    }
    await createAuditEvent({
      organizationId,
      actorUserId: session.userId,
      actorEmail: session.userEmail,
      action: "organization.category_changed",
      entityType: "organization",
      entityId: organizationId,
      metadata: {
        from: organization.category,
        to: input.category,
        presetsApplied: Boolean(input.applyPresets),
      },
    });
    return Response.json({ ok: true, data: { category: input.category, presetsApplied: Boolean(input.applyPresets) } });
  });
}
