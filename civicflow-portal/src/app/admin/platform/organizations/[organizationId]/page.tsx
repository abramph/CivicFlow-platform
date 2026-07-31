import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guards";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate, formatDateTime, formatEnumLabel } from "@/lib/formatting";
import { getOrganizationDetail } from "@/lib/platform-operations/organizations";
import { listOrganizationMembersForImpersonation } from "@/lib/platform-operations/impersonation";
import { Breadcrumbs, StatusPill, EmptyState } from "@/components/admin/OperationsUI";
import { CopyIdButton } from "@/components/admin/CopyIdButton";
import { OpenInOrganizationPortalButton } from "@/components/admin/OpenInOrganizationPortalButton";
import { ImpersonateUserPanel } from "@/components/admin/ImpersonateUserPanel";
import { PrimaryVerticalManager } from "@/components/admin/PrimaryVerticalManager";
import { getVerticalTerminology } from "@/lib/vertical-terminology";

export default async function PlatformOrganizationDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireSuperAdmin();
  const { organizationId } = await params;

  const detail = await getOrganizationDetail(organizationId);
  if (!detail) notFound();

  const { identity, membership, billing, communications, operationalHealth } = detail;
  const impersonationCandidates = await listOrganizationMembersForImpersonation(organizationId);
  const stripeDashboardUrl = billing.stripeCustomerId
    ? `https://dashboard.stripe.com/customers/${encodeURIComponent(billing.stripeCustomerId)}`
    : null;

  return (
    <main className="space-y-6">
      <Breadcrumbs
        items={[
          { href: "/admin/platform", label: "Overview" },
          { href: "/admin/platform/organizations", label: "Organizations" },
          { label: identity.name },
        ]}
      />
      <PageHeader
        title={identity.name}
        description="Platform-operations view — not an impersonated tenant view. No tenant business records (members, dues, contributions) are shown here."
        actions={[{ href: "/admin/platform/audit?organizationId=" + identity.id, label: "View audit events" }]}
      />
      {identity.billingExempt ? (
        <div className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">Internal · Billing-exempt.</span>{" "}
          This organization is exempt from trial expiration and subscription requirements — it is not a paying
          customer and is excluded from paid-customer MRR and missing-Stripe-linkage checks.
        </div>
      ) : null}

      <SectionCard title="Identity">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Organization ID</p>
            <div className="mt-1"><CopyIdButton id={identity.id} label="organization ID" /></div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Slug</p>
            <p className="mt-1 text-sm text-slate-900">{identity.slug}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Type</p>
            <p className="mt-1 text-sm text-slate-900">{identity.organizationType ? formatEnumLabel(identity.organizationType) : "Not set"}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Vertical</p>
            <p className="mt-1 text-sm text-slate-900">{getVerticalTerminology(identity.primaryVertical).productLabel}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Status</p>
            <div className="mt-1"><StatusPill status={identity.status} /></div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Plan</p>
            <p className="mt-1 text-sm text-slate-900">{formatEnumLabel(identity.plan)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Created</p>
            <p className="mt-1 text-sm text-slate-900">{formatDate(identity.createdAt)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Owner / primary administrator</p>
            <p className="mt-1 text-sm text-slate-900">
              {identity.ownerSummary ? `${identity.ownerSummary.displayName ?? identity.ownerSummary.email}` : "None active"}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Overall health</p>
            <div className="mt-1"><StatusPill status={operationalHealth.health} /></div>
          </div>
        </div>
        <div className="mt-4">
          <OpenInOrganizationPortalButton organizationId={identity.id} />
        </div>
      </SectionCard>

      <SectionCard
        title="Primary vertical"
        description="The product experience this organization sees. Changing it never deletes data — see the impact preview before confirming."
      >
        <PrimaryVerticalManager organizationId={identity.id} currentVertical={identity.primaryVertical} />
      </SectionCard>

      <SectionCard
        title="Impersonate a user"
        description="Experience this organization exactly as one of its members would — for demos, QA, and support. Unlike “Open in organization portal” above (which only works for orgs you're a real member of), this works for any organization and any active member, and is fully audited."
      >
        <ImpersonateUserPanel organizationId={identity.id} candidates={impersonationCandidates} />
      </SectionCard>

      <SectionCard title="Membership summary">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active memberships" value={membership.totalActive} />
          <StatCard label="Pending invitations" value={membership.pendingInvitations} helper="Member-portal invites" />
          <StatCard label="Deactivated" value={membership.deactivated} />
          <StatCard label="Multi-org members" value={membership.multiOrgMemberCount} />
        </div>
        {Object.keys(membership.roleDistribution).length > 0 ? (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Role distribution</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(membership.roleDistribution).map(([role, count]) => (
                <span key={role} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
                  {formatEnumLabel(role)}: {count}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Subscription and billing summary">
        {billing.latestSubscription ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm font-medium text-slate-700">Status</p>
              <div className="mt-1"><StatusPill status={billing.latestSubscription.status} /></div>
            </div>
            <StatCard label="Plan" value={formatEnumLabel(billing.latestSubscription.plan)} />
            <StatCard label="Current period end" value={formatDate(billing.latestSubscription.currentPeriodEnd)} />
            <StatCard label="Trial ends" value={formatDate(billing.latestSubscription.trialEndsAt)} />
            <StatCard label="Cancels at period end" value={billing.latestSubscription.cancelAtPeriodEnd ? "Yes" : "No"} />
            <div>
              <p className="text-sm font-medium text-slate-700">Stripe customer</p>
              {stripeDashboardUrl ? (
                <a href={stripeDashboardUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-emerald-700 hover:underline">
                  View in Stripe Dashboard →
                </a>
              ) : (
                <p className="mt-1 text-sm text-slate-600">Not linked</p>
              )}
            </div>
          </div>
        ) : identity.billingExempt ? (
          <EmptyState
            title="Subscription not required"
            description="This is the internal platform-owning organization — it is exempt from billing, not missing a subscription."
          />
        ) : (
          <EmptyState title="No subscription record" description="This organization has no Subscription row at all." />
        )}
      </SectionCard>

      <SectionCard title="Communications summary">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="SMS add-on" value={communications.smsAddOnActive ? "Active" : "Not active"} />
          <StatCard label="Members opted into SMS" value={communications.smsConsentCount} />
          <StatCard label="SMS sent (30 days)" value={communications.smsSentLast30Days} />
          <StatCard label="SMS failed (30 days)" value={communications.smsFailedLast30Days} />
        </div>
      </SectionCard>

      <SectionCard title="Operational health" description="Recent platform-level audit events concerning this organization.">
        {operationalHealth.recentAuditEvents.length === 0 ? (
          <EmptyState title="No recent audit events for this organization" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {operationalHealth.recentAuditEvents.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{event.action}</p>
                  <p className="text-slate-600">{event.actorEmail ?? "system"}</p>
                </div>
                <p className="shrink-0 text-slate-500">{formatDateTime(event.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <Link href={`/admin/platform/audit?organizationId=${identity.id}`} className="text-sm font-semibold text-emerald-700 hover:underline">
            View all audit events for this organization →
          </Link>
        </div>
      </SectionCard>
    </main>
  );
}
