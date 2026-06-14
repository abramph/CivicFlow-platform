import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { OrganizationSettingsForm } from "@/components/forms/OrganizationSettingsForm";
import { AttachmentManager } from "@/components/forms/AttachmentManager";
import { canDo } from "@/lib/rbac";

export default async function OrgSettingsPage() {
  const { organizationId, role } = await requirePermission("org_settings:read");

  const [organization, settings, membershipCategoryCount, duesCategoryCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        slug: true,
        organizationType: true,
        email: true,
        phone: true,
        website: true,
        logoUrl: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        zipCode: true,
        country: true,
      },
    }),
    prisma.orgSettings.findUnique({
      where: { organizationId },
      select: {
        timezone: true,
        currency: true,
        fiscalYearStart: true,
        emailFrom: true,
        customDomain: true,
      },
    }),
    prisma.category.count({
      where: { organizationId, type: "MEMBERSHIP" },
    }),
    prisma.category.count({
      where: { organizationId, type: "DUES" },
    }),
  ]);

  if (!organization) {
    return (
      <main className="space-y-6">
        <PageHeader
          title="Organization settings"
          description="The organization record could not be loaded for the current session."
          actions={[
            { href: "/settings", label: "Settings Hub" },
            { href: "/dashboard", label: "Back to Dashboard" },
          ]}
        />
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title="Organization Settings"
        description="Maintain the core organization profile, contact details, timezone, fiscal year, and outbound email defaults used across the SaaS portal."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Back to Dashboard" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Your Role" value={role} />
        <StatCard label="Membership Categories" value={membershipCategoryCount} />
        <StatCard label="Dues Categories" value={duesCategoryCount} />
        <StatCard label="Timezone" value={settings?.timezone ?? "America/New_York"} />
      </div>

      <SectionCard title="Organization Profile" description="Changes save through the protected organization settings API and stay scoped to the organization attached to your session.">
        <OrganizationSettingsForm organization={organization} settings={settings} />
      </SectionCard>

      <SectionCard title="Organization Logo Upload" description="Upload a private logo file for organization branding. The latest active logo is linked to the organization profile.">
        <AttachmentManager entityType="ORGANIZATION" entityId={organizationId} purpose="LOGO" canWrite={canDo(role, "org_settings:write")} titleLabel="Logo title" />
      </SectionCard>
    </main>
  );
}
