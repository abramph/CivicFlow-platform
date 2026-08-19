"use client";

import { useState } from "react";
import { plansForVertical, type BillingInterval, type PricingVertical } from "@/lib/plans";
import { SubscribeButton } from "@/components/app/BillingActions";

interface BillingPlansProps {
  vertical: PricingVertical;
  currentPlanId: string;
  isInTrial: boolean;
  hasActiveSubscription: boolean;
  canManageBilling: boolean;
}

function SeatStepper({
  value,
  onChange,
  seatCents,
  interval,
}: {
  value: number;
  onChange: (n: number) => void;
  seatCents: number;
  interval: BillingInterval;
}) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="mb-1.5 text-xs font-medium text-slate-600">Additional seats</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          disabled={value === 0}
        >
          −
        </button>
        <span className="min-w-[1.5rem] text-center text-sm font-semibold text-slate-900">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(50, value + 1))}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100"
        >
          +
        </button>
        {value > 0 && (
          <span className="text-xs text-slate-500">
            +${((seatCents * value) / 100).toFixed(0)}/{interval === "year" ? "yr" : "mo"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Unestra Cloud (CLOUD-D): an organization has exactly one plan — its own
 * vertical's Cloud plan — with a choice of billing interval, not a tier
 * ladder to pick between. Renders the two interval variants
 * (plansForVertical) side by side rather than the old essential/elite
 * comparison grid.
 */
export function BillingPlans({ vertical, currentPlanId, isInTrial, hasActiveSubscription, canManageBilling }: BillingPlansProps) {
  const [additionalSeats, setAdditionalSeats] = useState(0);
  const plans = plansForVertical(vertical);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const interval = plan.interval as BillingInterval;
          const isCurrentSelection = !isInTrial && currentPlanId === plan.id;
          const effectiveMonthly = interval === "year" ? Math.round(plan.yearlyPriceCents / 12) : plan.monthlyPriceCents;
          const price = interval === "year" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const seatCents = interval === "year" ? plan.additionalSeatCentsYearly : plan.additionalSeatCentsMonthly;
          const totalSeats = plan.includedSeats + additionalSeats;

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
                    <p className="text-xs text-slate-500">${(price / 100).toFixed(0)} billed annually — 2 months free</p>
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
                <li className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="mt-0.5">+</span>
                  ${(seatCents / 100).toFixed(0)}/{interval === "year" ? "yr" : "mo"} per additional seat
                </li>
              </ul>

              {canManageBilling && !hasActiveSubscription ? (
                <>
                  <SeatStepper value={additionalSeats} onChange={setAdditionalSeats} seatCents={seatCents} interval={interval} />
                  {additionalSeats > 0 && (
                    <p className="mb-2 text-center text-xs text-slate-500">{totalSeats} total seats</p>
                  )}
                  <SubscribeButton
                    isCurrentSelection={isCurrentSelection}
                    interval={interval}
                    additionalSeats={additionalSeats}
                    label={isInTrial ? `Subscribe — $${(effectiveMonthly / 100).toFixed(0)}/mo` : undefined}
                  />
                </>
              ) : !canManageBilling ? (
                <p className="text-center text-xs text-slate-500">Contact your org owner to change plans</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {hasActiveSubscription && canManageBilling && (
        <p className="text-sm text-slate-600">
          To add seats, change billing interval, or cancel, open the <span className="font-medium text-slate-900">billing portal</span> below.
        </p>
      )}
    </div>
  );
}
