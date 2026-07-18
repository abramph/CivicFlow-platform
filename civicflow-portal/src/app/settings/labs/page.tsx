import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { PageHeader, SectionCard } from "@/components/app/PageChrome";
import { listOrganizationLabAccess } from "@/lib/labs/access";
import { findLabFeature } from "@/lib/labs/registry";

const STATUS_LABEL: Record<string, string> = {
  LAB_FEATURE_NOT_ENTITLED: "Not included in your current plan",
  LAB_FEATURE_NOT_ENROLLED: "Not yet enabled for your organization",
  LAB_FEATURE_DISABLED: "Disabled for your organization",
  LAB_FEATURE_SUSPENDED: "Suspended for your organization",
  LAB_FEATURE_NOT_ENABLED: "Not yet available",
};

export default async function OrganizationLabsPage() {
  const { organizationId } = await requirePermission("labs:read");
  const access = await listOrganizationLabAccess(organizationId);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Unestra Labs"
        description="Experimental and early-access capabilities for your organization."
        actions={[{ href: "/settings", label: "Settings Hub" }]}
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">Experimental features</p>
        <p className="mt-1">
          Labs features are experimental, may change or be discontinued at any time, and are not part of your
          standard plan features. Where a Labs feature produces AI-generated content, that content is never
          published or acted on automatically — a person always reviews it first.
        </p>
      </div>

      <SectionCard title="Available Labs features" description="Enabling or disabling a feature for your organization is managed by the Unestra platform team.">
        {access.length === 0 ? (
          <p className="text-sm text-slate-600">
            No Labs features are currently available for your organization. Check back later, or contact support
            about early access.
          </p>
        ) : (
          <ul className="space-y-3">
            {access.map((item) => {
              const feature = findLabFeature(item.featureKey);
              if (!feature) return null;
              return (
                <li key={item.featureKey} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{feature.name}</p>
                      <p className="text-xs text-slate-600">{feature.description}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                        item.available ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {item.available ? "Enabled" : STATUS_LABEL[item.denialReason ?? ""] ?? "Not available"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <p className="text-sm text-slate-600">
        Questions about a Labs feature or interested in early access?{" "}
        <Link href="/settings/billing" className="font-medium text-emerald-700 hover:underline">
          Visit Billing Settings
        </Link>{" "}
        or contact your account representative.
      </p>
    </main>
  );
}
