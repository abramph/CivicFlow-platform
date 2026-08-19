import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate } from "@/lib/formatting";
import { getPlan, resolvePricingVertical } from "@/lib/plans";
import { ManageBillingButton } from "@/components/app/BillingActions";
import { BillingPlans } from "@/components/app/BillingPlans";
import { SmsAddOnCard } from "@/components/app/SmsAddOnCard";
import { checkMemberLimit, getTrialStatus } from "@/lib/plan-gate";
import { getAdminSeatSummary } from "@/lib/admin-seats";
import { SUPPORT_EMAIL } from "@/lib/brand";

type SearchParams = Promise<{ success?: string }>;

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { organizationId, role, can } = await requirePermission("billing:read");

  const [organization, subscription, memberCheck, trial, adminSeats] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, plan: true, status: true, createdAt: true, billingExempt: true, primaryVertical: true },
    }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    checkMemberLimit(organizationId),
    getTrialStatus(organizationId),
    getAdminSeatSummary(organizationId),
  ]);

  const currentPlanId = organization?.plan ?? "free";
  const currentPlan = getPlan(currentPlanId);
  const canManageBilling = can("billing:manage");
  const isBillingExemptOrg = organization?.billingExempt ?? false;
  const pricingVertical = resolvePricingVertical(organization?.primaryVertical ?? "COMMUNITY");
  const trialPlan = getPlan(`${pricingVertical.toLowerCase()}_monthly`);

  // Org has an active Stripe subscription — plan changes must go through the
  // billing portal, not a new checkout session.
  const hasActiveSubscription = Boolean(
    subscription?.stripeCustomerId &&
    ["active", "trialing", "past_due"].includes(subscription?.status ?? "")
  );

  return (
    <main className="space-y-6">
      <PageHeader
        title="Billing & Subscription"
        description="Manage your plan, upgrade, and access the Stripe billing portal."
        actions={[
          { href: "/settings", label: "Settings Hub" },
          { href: "/dashboard", label: "Dashboard" },
        ]}
      />

      {params.success === "1" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
          Payment successful — your plan may take a moment to update as we process the webhook from Stripe.
        </div>
      ) : null}

      {/* Internal/billing-exempt banner — takes the place of the trial banner and upgrade CTAs below, since neither applies. */}
      {isBillingExemptOrg ? (
        <div className="rounded-xl border border-slate-300 bg-slate-50 px-5 py-4">
          <p className="text-sm font-semibold text-slate-900">Internal platform organization</p>
          <p className="mt-1 text-sm text-slate-700">
            Billing subscription not required. This organization is exempt from trial expiration and subscription
            gating because it is the internal, platform-owning organization — not an ordinary tenant.
          </p>
        </div>
      ) : trial.isInTrial ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-semibold text-blue-900">
            Free trial — {trial.daysRemaining} day{trial.daysRemaining === 1 ? "" : "s"} remaining
          </p>
          <p className="mt-1 text-sm text-blue-700">
            You have full {trialPlan.name} access until{" "}
            <span className="font-medium">{formatDate(trial.trialEndsAt)}</span>.
            Subscribe before then to keep your access uninterrupted.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Current Plan"
          value={isBillingExemptOrg ? "Internal (exempt)" : trial.isInTrial ? `${trialPlan.name} (trial)` : currentPlan.name}
          helper={isBillingExemptOrg ? "Not a paying customer" : trial.isInTrial ? `Trial ends ${formatDate(trial.trialEndsAt)}` : currentPlan.description}
        />
        <StatCard
          label="Members"
          value={`${memberCheck.current}`}
          helper="Unlimited — every Unestra Cloud plan includes unlimited members"
        />
        <StatCard
          label="Administrative Seats"
          value={`${adminSeats.usedAdminSeats} / ${adminSeats.effectiveAdminSeatLimit}`}
          helper={
            adminSeats.availableAdminSeats > 0
              ? `${adminSeats.availableAdminSeats} seat${adminSeats.availableAdminSeats === 1 ? "" : "s"} available`
              : "No seats available — deactivate an unused administrator or contact support"
          }
        />
        <StatCard
          label="Subscription Status"
          value={isBillingExemptOrg ? "Not required" : (subscription?.status ?? (trial.isInTrial ? "trial" : "none"))}
        />
        <StatCard label="Your Role" value={role} />
      </div>

      {/* Administrative seats — a separate entitlement from ordinary members
          (unlimited on every plan, see the "Members" card above). Only
          counts users with material organization-management authority. */}
      <SectionCard
        title="Administrative Seats"
        description="Included with your plan for staff and officers who manage the organization. Ordinary members, congregants, parents, and volunteers never count toward this."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Included" value={adminSeats.includedAdminSeats} />
          <StatCard label="Additional" value={adminSeats.effectiveAdminSeatLimit - adminSeats.includedAdminSeats} />
          <StatCard label="Effective limit" value={adminSeats.effectiveAdminSeatLimit} />
          <StatCard label="Used" value={adminSeats.usedAdminSeats} />
        </div>
        {adminSeats.availableAdminSeats === 0 ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You are using all included administrative seats for your Unestra Cloud plan. Deactivate an unused
            administrator or contact Unestra Support to request additional administrative access.
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <Link href="/settings/users" className="font-semibold text-emerald-700 hover:underline">
            Manage administrators →
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-slate-600 hover:underline">
            Contact Unestra Support
          </a>
        </div>
      </SectionCard>

      {/* Current plan features */}
      <SectionCard
        title={`${trial.isInTrial ? `${trialPlan.name} (trial)` : currentPlan.name} — What's included`}
        description={trial.isInTrial ? trialPlan.description : currentPlan.description}
      >
        <ul className="mt-2 space-y-2">
          {(trial.isInTrial ? trialPlan : currentPlan).highlights.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-slate-700">
              <span className="text-emerald-600">✓</span> {item}
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Plan comparison & actions — omitted entirely for a billing-exempt organization; there is nothing to buy or upgrade. */}
      {!isBillingExemptOrg ? (
        <SectionCard
          title="Plan"
          description={
            hasActiveSubscription
              ? "Use the billing portal below to change your billing interval or cancel."
              : "Choose your billing interval. Changes take effect immediately after payment."
          }
        >
          <BillingPlans
            vertical={pricingVertical}
            currentPlanId={currentPlanId}
            isInTrial={trial.isInTrial}
            hasActiveSubscription={hasActiveSubscription}
            canManageBilling={canManageBilling}
          />
        </SectionCard>
      ) : null}

      {/* SMS add-on */}
      <SectionCard title="SMS" description="SMS is a paid add-on — never bundled free into any plan, since each message costs real money to deliver.">
        <SmsAddOnCard canManageBilling={canManageBilling} hasActiveSubscription={hasActiveSubscription} />
      </SectionCard>

      {/* Subscription management */}
      {subscription ? (
        <SectionCard
          title="Subscription Management"
          description="Update your payment method, view invoices, change plans, or cancel via Stripe."
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1 space-y-1 text-sm text-slate-700">
              {subscription.currentPeriodStart && subscription.currentPeriodEnd ? (
                <p>Period: {formatDate(subscription.currentPeriodStart)} – {formatDate(subscription.currentPeriodEnd)}</p>
              ) : null}
              {subscription.cancelAtPeriodEnd ? (
                <p className="font-semibold text-red-600">
                  Cancels at period end ({formatDate(subscription.currentPeriodEnd)})
                </p>
              ) : null}
            </div>
            {canManageBilling ? (
              <ManageBillingButton hasSubscription={hasActiveSubscription} />
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <div className="text-sm text-slate-600">
        View the public{" "}
        <Link href="/pricing" className="font-medium text-emerald-700 hover:underline">
          pricing page
        </Link>{" "}
        for a full feature comparison.
      </div>

      <p className="text-xs text-slate-400">
        Unestra is a product of APH Technologies, LLC. Subscription charges appear on your statement
        as billed by APH Technologies, LLC.
      </p>
    </main>
  );
}
