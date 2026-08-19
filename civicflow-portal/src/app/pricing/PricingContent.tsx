"use client";

import { useState } from "react";
import Link from "next/link";
import { activePlans, annualSavingsCentsForVertical, type PricingVertical } from "@/lib/plans";

const VERTICAL_LABELS: Record<PricingVertical, string> = {
  PTA: "PTA / PTO",
  COMMUNITY: "Community / Nonprofit",
  CHURCH: "Church",
  UNION: "Union",
};

export default function PricingContent() {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const plans = activePlans().filter((plan) => plan.interval === interval);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Unestra Cloud</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">
            Simple, transparent pricing by vertical
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Every Unestra Cloud plan includes unlimited members. Every plan starts with a 30-day free trial.
          </p>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setInterval("month")}
            aria-pressed={interval === "month"}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              interval === "month" ? "bg-slate-950 text-white" : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("year")}
            aria-pressed={interval === "year"}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              interval === "year" ? "bg-slate-950 text-white" : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            Annual <span className="font-normal opacity-80">(save with annual billing)</span>
          </button>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const priceCents = interval === "month" ? plan.monthlyPriceCents : plan.yearlyPriceCents;
            const perMonthEquivalent = interval === "year" ? priceCents / 12 : priceCents;

            return (
              <div
                key={plan.id}
                className="relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    {VERTICAL_LABELS[plan.vertical!]}
                  </p>
                  <p className="mt-3 text-3xl font-bold text-slate-950">
                    ${(priceCents / 100).toFixed(0)}
                    <span className="text-base font-normal text-slate-500">
                      {" "}
                      / {interval === "month" ? "month" : "year"}
                    </span>
                  </p>
                  {interval === "year" ? (
                    <p className="mt-1 text-xs text-slate-500">
                      ${(perMonthEquivalent / 100).toFixed(2)}/mo equivalent — save $
                      {(annualSavingsCentsForVertical(plan.vertical!) / 100).toFixed(0)}/year
                    </p>
                  ) : null}
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  <li className="flex items-start gap-2.5 text-sm font-semibold text-emerald-700">
                    <span className="mt-0.5 shrink-0">✓</span>
                    Unlimited members
                  </li>
                  {plan.highlights
                    .filter((item) => item !== "Unlimited members")
                    .map((item) => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                        <span className="mt-0.5 shrink-0 text-emerald-600">✓</span>
                        {item}
                      </li>
                    ))}
                </ul>

                <Link
                  href="/signup"
                  className="mt-2 block rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
                >
                  Start free trial
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <h2 className="text-lg font-semibold text-slate-950">Questions?</h2>
          <p className="mt-2 text-sm text-slate-600">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-emerald-700 hover:underline">
              Sign in
            </Link>{" "}
            and go to Settings → Billing to upgrade.
          </p>
        </div>
      </div>
    </div>
  );
}
