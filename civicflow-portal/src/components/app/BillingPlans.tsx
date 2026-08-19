"use client";

import type { BillingInterval, PricingVertical } from "@/lib/plans";
import { annualSavingsCentsForVertical, plansForVertical } from "@/lib/plans";
import { SubscribeButton } from "@/components/app/BillingActions";

interface BillingPlansProps {
  vertical: PricingVertical;
  currentPlanId: string;
  isInTrial: boolean;
  hasActiveSubscription: boolean;
  canManageBilling: boolean;
}

/**
 * Unestra Cloud (CLOUD-D): an organization has exactly one plan — its own
 * vertical's Cloud plan — with a choice of billing interval, not a tier
 * ladder to pick between. Renders the two interval variants
 * (plansForVertical) side by side rather than the old essential/elite
 * comparison grid.
 *
 * CLOUD-I: administrative seats are never a paid add-on. There is no seat
 * quantity selector here — customers see only their included administrative-
 * seat allowance as a plan highlight (see plans.ts); additional capacity is
 * granted only via a platform-admin complimentary override
 * (/settings/billing shows the org's current usage/limit, never a purchase
 * control).
 */
export function BillingPlans({ vertical, currentPlanId, isInTrial, hasActiveSubscription, canManageBilling }: BillingPlansProps) {
  const plans = plansForVertical(vertical);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const interval = plan.interval as BillingInterval;
          const isCurrentSelection = !isInTrial && currentPlanId === plan.id;
          const effectiveMonthly = interval === "year" ? Math.round(plan.yearlyPriceCents / 12) : plan.monthlyPriceCents;
          const price = interval === "year" ? plan.yearlyPriceCents : plan.monthlyPriceCents;

          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border p-5 ${isCurrentSelection ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-950">{interval === "month" ? "Monthly" : "Annual"}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-950">
                    ${(effectiveMonthly / 100).toFixed(0)}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
                  {interval === "year" && (
                    <p className="text-xs text-slate-500">
                      ${(price / 100).toFixed(0)} billed annually — save $
                      {(annualSavingsCentsForVertical(vertical) / 100).toFixed(0)}/year
                    </p>
                  )}
                </div>
                {isInTrial ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Trial</span>
                ) : isCurrentSelection ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Current</span>
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

              {canManageBilling && !hasActiveSubscription ? (
                <SubscribeButton
                  isCurrentSelection={isCurrentSelection}
                  interval={interval}
                  label={isInTrial ? `Subscribe — $${(effectiveMonthly / 100).toFixed(0)}/mo` : undefined}
                />
              ) : !canManageBilling ? (
                <p className="text-center text-xs text-slate-500">Contact your org owner to change plans</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {hasActiveSubscription && canManageBilling && (
        <p className="text-sm text-slate-600">
          To change billing interval or cancel, open the <span className="font-medium text-slate-900">billing portal</span> below.
        </p>
      )}
    </div>
  );
}
