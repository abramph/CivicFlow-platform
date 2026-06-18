import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate } from "@/lib/formatting";
import { PLANS, getPlan } from "@/lib/plans";
import { ManageBillingButton } from "@/components/app/BillingActions";
import { BillingPlans } from "@/components/app/BillingPlans";
import { checkMemberLimit, getTrialStatus, checkSeatLimit } from "@/lib/plan-gate";

type SearchParams = Promise<{ success?: string }>;

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { organizationId, role } = await requirePermission("billing:read");

  const [organization, subscription, memberCheck, trial, seatCheck] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, plan: true, status: true, createdAt: true },
    }),
    prisma.subscription.findFirst({
      where: { organizationId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    checkMemberLimit(organizationId),
    getTrialStatus(organizationId),
    checkSeatLimit(organizationId),
  ]);

  const currentPlanId = organization?.plan ?? "free";
  const currentPlan = getPlan(currentPlanId);
  const canManageBilling = role === "ORG_OWNER" || role === "SUPER_ADMIN";

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

      {/* Trial banner */}
      {trial.isInTrial ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-semibold text-blue-900">
            Free trial — {trial.daysRemaining} day{trial.daysRemaining === 1 ? "" : "s"} remaining
          </p>
          <p className="mt-1 text-sm text-blue-700">
            You have full Essential access until{" "}
            <span className="font-medium">{formatDate(trial.trialEndsAt)}</span>.
            Subscribe before then to keep your access uninterrupted.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Current Plan"
          value={trial.isInTrial ? "Essential (trial)" : currentPlan.name}
          helper={trial.isInTrial ? `Trial ends ${formatDate(trial.trialEndsAt)}` : currentPlan.description}
        />
        <StatCard
          label="Members"
          value={`${memberCheck.current}${memberCheck.limit === Infinity ? "" : ` / ${memberCheck.limit}`}`}
          helper={memberCheck.limit === Infinity ? "Unlimited" : `${memberCheck.limit - memberCheck.current} slots remaining`}
        />
        <StatCard
          label="Portal Users (Seats)"
          value={`${seatCheck.current} / ${seatCheck.limit}`}
          helper={seatCheck.allowed ? `${seatCheck.limit - seatCheck.current} seat${seatCheck.limit - seatCheck.current === 1 ? "" : "s"} available` : "Seat limit reached"}
        />
        <StatCard label="Subscription Status" value={subscription?.status ?? (trial.isInTrial ? "trial" : "none")} />
        <StatCard label="Your Role" value={role} />
      </div>

      {/* Current plan features */}
      <SectionCard
        title={`${trial.isInTrial ? "Essential (trial)" : currentPlan.name} — What's included`}
        description={trial.isInTrial ? PLANS.essential.description : currentPlan.description}
      >
        <ul className="mt-2 space-y-2">
          {(trial.isInTrial ? PLANS.essential : currentPlan).highlights.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-slate-700">
              <span className="text-emerald-600">✓</span> {item}
            </li>
          ))}
        </ul>
        {currentPlan.limits.members !== Infinity && !memberCheck.allowed ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You have reached your member limit ({memberCheck.current}/{memberCheck.limit}). Upgrade to add more members.
          </div>
        ) : null}
      </SectionCard>

      {/* Plan comparison & actions */}
      <SectionCard
        title="Plans"
        description={
          hasActiveSubscription
            ? "Use the billing portal below to change or cancel your plan."
            : "Choose a plan and billing cycle. Changes take effect immediately after payment."
        }
      >
        <BillingPlans
          currentPlanId={currentPlanId}
          isInTrial={trial.isInTrial}
          hasActiveSubscription={hasActiveSubscription}
          canManageBilling={canManageBilling}
        />
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
    </main>
  );
}
