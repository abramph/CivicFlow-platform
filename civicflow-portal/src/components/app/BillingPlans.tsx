"use client";

import { useState } from "react";
import { PLANS, type BillingInterval } from "@/lib/plans";
import { UpgradeButton } from "@/components/app/BillingActions";
import { planRank } from "@/lib/plans";

interface BillingPlansProps {
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

export function BillingPlans({ currentPlanId, isInTrial, hasActiveSubscription, canManageBilling }: BillingPlansProps) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [additionalSeats, setAdditionalSeats] = useState<Record<string, number>>({
    essential: 0,
    elite: 0,
  });
  const plans = [PLANS.essential, PLANS.elite] as const;

  return (
    <div className="space-y-5">
      {/* Interval toggle */}
      <div className="flex items-center gap-3">
        <span className={`text-sm font-medium ${interval === "month" ? "text-slate-950" : "text-slate-400"}`}>Monthly</span>
        <button
          type="button"
          onClick={() => setInterval(interval === "month" ? "year" : "month")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${interval === "year" ? "bg-emerald-600" : "bg-slate-200"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${interval === "year" ? "translate-x-6" : "translate-x-1"}`} />
        </button>
        <span className={`text-sm font-medium ${interval === "year" ? "text-slate-950" : "text-slate-400"}`}>
          Yearly
          <span className="ml-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">1 month free</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((plan) => {
          const isCurrent = !isInTrial && currentPlanId === plan.id;
          const isTrialPlan = isInTrial && plan.id === "essential";
          const isUpgrade = planRank(plan.id) > planRank(isInTrial ? "essential" : currentPlanId);
          const isDowngrade = planRank(plan.id) < planRank(isInTrial ? "essential" : currentPlanId);

          const basePrice = interval === "year" ? plan.yearlyPriceCents : plan.monthlyPriceCents;
          const effectiveMonthly = interval === "year" ? Math.round(plan.yearlyPriceCents / 12) : plan.monthlyPriceCents;
          const seatCents = interval === "year" ? plan.additionalSeatCentsYearly : plan.additionalSeatCentsMonthly;
          const extraSeats = additionalSeats[plan.id] ?? 0;
          const totalSeats = plan.includedSeats + extraSeats;

          return (
            <div
              key={plan.id}
              className={`flex flex-col rounded-xl border p-5 ${isCurrent || isTrialPlan ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-950">{plan.name}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-950">
                    ${(effectiveMonthly / 100).toFixed(0)}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
                  {interval === "year" && (
                    <p className="text-xs text-slate-500">${(basePrice / 100).toFixed(0)} billed annually</p>
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
                <li className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="mt-0.5">+</span>
                  ${(seatCents / 100).toFixed(0)}/{interval === "year" ? "yr" : "mo"} per additional seat
                </li>
              </ul>

              {canManageBilling && !hasActiveSubscription ? (
                <>
                  <SeatStepper
                    value={extraSeats}
                    onChange={(n) => setAdditionalSeats((prev) => ({ ...prev, [plan.id]: n }))}
                    seatCents={seatCents}
                    interval={interval}
                  />
                  {extraSeats > 0 && (
                    <p className="mb-2 text-center text-xs text-slate-500">{totalSeats} total seats</p>
                  )}
                  <UpgradeButton
                    plan={plan.id as "essential" | "elite"}
                    currentPlan={currentPlanId}
                    interval={interval}
                    additionalSeats={extraSeats}
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
          To add seats, change billing interval, upgrade, or cancel, open the <span className="font-medium text-slate-900">billing portal</span> below.
        </p>
      )}
    </div>
  );
}
