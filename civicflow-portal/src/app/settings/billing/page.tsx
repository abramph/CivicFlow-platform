import Link from "next/link";
import { requirePermission } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { PageHeader, SectionCard, StatCard } from "@/components/app/PageChrome";
import { formatDate } from "@/lib/formatting";
import { PLANS, getPlan, planRank } from "@/lib/plans";
import { UpgradeButton, ManageBillingButton } from "@/components/app/BillingActions";
import { checkMemberLimit, getTrialStatus } from "@/lib/plan-gate";

type SearchParams = Promise<{ success?: string }>;

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { organizationId, role } = await requirePermission("billing:read");

  const [organization, subscription, memberCheck, trial] = await Promise.all([
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

  const planOrder: Array<keyof typeof PLANS> = ["essential", "elite"];

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
            : "Choose a plan. Changes take effect immediately after payment."
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {planOrder.map((planId) => {
            const plan = PLANS[planId];
            const isCurrent = !trial.isInTrial && currentPlanId === planId;
            const isTrialPlan = trial.isInTrial && planId === "essential";
            const isUpgrade = planRank(planId) > planRank(trial.isInTrial ? "essential" : currentPlanId);
            const isDowngrade = planRank(planId) < planRank(trial.isInTrial ? "essential" : currentPlanId);

            return (
              <div
                key={planId}
                className={`flex flex-col rounded-xl border p-5 ${
                  isCurrent || isTrialPlan
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-slate-200 bg-white"
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-950">{plan.name}</p>
                    {plan.monthlyPriceCents === 0 ? (
                      <p className="mt-1 text-2xl font-bold text-slate-950">Free</p>
                    ) : (
                      <p className="mt-1 text-2xl font-bold text-slate-950">
                        ${(plan.monthlyPriceCents / 100).toFixed(0)}
                        <span className="text-sm font-normal text-slate-500">/mo</span>
                      </p>
                    )}
                  </div>
                  {isTrialPlan ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Trial</span>
                  ) : isCurrent ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Current</span>
                  ) : isUpgrade ? (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Upgrade</span>
                  ) : isDowngrade ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Downgrade</span>
                  ) : null}
                </div>

                <ul className="mb-4 flex-1 space-y-1.5">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-slate-700">
                      <span className="mt-0.5 text-emerald-600">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>

                {/* Action area */}
                {canManageBilling && !hasActiveSubscription ? (
                  <UpgradeButton
                    plan={planId as "essential" | "elite"}
                    currentPlan={currentPlanId}
                    label={trial.isInTrial ? `Subscribe — $${(plan.monthlyPriceCents / 100).toFixed(0)}/mo` : undefined}
                  />
                ) : !canManageBilling ? (
                  <p className="text-center text-xs text-slate-500">Contact your org owner to change plans</p>
                ) : null}
              </div>
            );
          })}
        </div>

        {hasActiveSubscription && canManageBilling ? (
          <p className="mt-4 text-sm text-slate-600">
            To upgrade, downgrade, or cancel, open the{" "}
            <span className="font-medium text-slate-900">billing portal</span> below.
          </p>
        ) : null}
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
