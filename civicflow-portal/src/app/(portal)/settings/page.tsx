import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { canDo, type Role } from "@/lib/rbac";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  const hasLegacySession = Boolean(session?.org_id && session?.api_key && !session?.userId);
  const hasSaasSession = Boolean(session?.userId && session?.organizationId && session?.role);

  if (!hasLegacySession && !hasSaasSession) {
    redirect("/login");
  }

  if (hasLegacySession) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Legacy cloud payments connection profile."
          actions={[{ href: "/dashboard", label: "Back to Dashboard" }]}
        />

        <SectionCard title="Connection Profile" description="Legacy API-key session details preserved for the cloud payments workflow.">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-medium text-slate-700">Organization ID</dt>
              <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-900">{session?.org_id}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">API Base URL</dt>
              <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-900">{session?.api_base}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">API Key</dt>
              <dd className="mt-1 rounded-md bg-slate-50 px-3 py-2 font-mono text-slate-900">Configured in session</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    );
  }

  const organizationId = String(session?.organizationId ?? "");
  const role = (session?.role ?? "READ_ONLY") as Role;
  const [organization, membershipCategoryCount, duesCategoryCount, paymentMethodCount] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        name: true,
        slug: true,
        plan: true,
      },
    }),
    prisma.category.count({
      where: { organizationId, type: "MEMBERSHIP" },
    }),
    prisma.category.count({
      where: { organizationId, type: "DUES" },
    }),
    prisma.paymentMethodConfig.count({
      where: { organizationId, isActive: true },
    }),
  ]);

  const tiles = [
    { href: "/settings/organization", label: "Organization Profile", visible: canDo(role, "org_settings:read") },
    { href: "/settings/categories", label: "Categories", visible: canDo(role, "org_settings:read") },
    { href: "/settings/dues", label: "Dues Setup", visible: canDo(role, "dues:read") },
    { href: "/settings/payment-methods", label: "Payment Methods", visible: canDo(role, "org_settings:read") },
    { href: "/settings/users", label: "Users & Roles", visible: canDo(role, "users:read") },
    { href: "/settings/billing", label: "Billing", visible: canDo(role, "billing:read") },
    { href: "/onboarding/organization", label: "Onboarding", visible: true },
  ].filter((tile) => tile.visible);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Settings"
        description="Desktop-style SaaS setup hub for organization profile, category and dues configuration, user access, billing, and onboarding."
        actions={[{ href: "/dashboard", label: "Back to Dashboard" }]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Organization" value={organization?.name ?? "Unknown"} helper={organization?.slug ?? "No slug"} />
        <StatCard label="Plan" value={organization?.plan ?? "free"} />
        <StatCard label="Membership Categories" value={membershipCategoryCount} />
        <StatCard label="Dues Categories" value={duesCategoryCount} helper={`${paymentMethodCount} active payment methods`} />
      </div>

      <SectionCard title="Setup Areas" description="Use these setup screens to mirror the desktop app’s organization, category, dues, and access management workflows.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tiles.map((tile) => (
            <Link key={tile.href} href={tile.href} className="rounded-xl border border-slate-300 bg-white p-4 hover:bg-slate-50">
              <p className="text-sm font-semibold text-slate-950">{tile.label}</p>
              <p className="mt-2 text-sm text-slate-700">Open {tile.label.toLowerCase()}.</p>
            </Link>
          ))}
        </div>
      </SectionCard>
    </main>
  );
}
