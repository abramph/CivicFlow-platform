import Link from "next/link";
import { PLANS } from "@/lib/plans";

export const metadata = {
  title: "Pricing — Unestra",
  description: "Simple, transparent pricing for community and nonprofit organizations.",
};

export default function PricingPage() {
  const plans = [PLANS.essential, PLANS.elite];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-950">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Built for community organizations and nonprofits. Every plan starts with a 30-day free trial.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2 max-w-2xl mx-auto">
          {plans.map((plan) => {
            const isPopular = plan.id === "essential";

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-7 ${
                  isPopular
                    ? "border-emerald-400 bg-white shadow-lg"
                    : "border-slate-200 bg-white"
                }`}
              >
                {isPopular ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-1 text-xs font-bold text-white">
                    Most popular
                  </div>
                ) : null}

                <div className="mb-5">
                  <p className="text-base font-bold text-slate-950">{plan.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{plan.description}</p>

                  {plan.monthlyPriceCents === 0 ? (
                    <p className="mt-4 text-4xl font-bold text-slate-950">Free</p>
                  ) : (
                    <p className="mt-4 text-4xl font-bold text-slate-950">
                      ${(plan.monthlyPriceCents / 100).toFixed(0)}
                      <span className="text-base font-normal text-slate-500"> / month</span>
                    </p>
                  )}
                </div>

                <ul className="mb-6 flex-1 space-y-2.5">
                  {plan.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="mt-0.5 shrink-0 text-emerald-600">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="space-y-1.5 border-t border-slate-100 pt-4 text-xs text-slate-500">
                  <p>
                    <span className="font-medium">Members:</span>{" "}
                    {plan.limits.members === Infinity ? "Unlimited" : `Up to ${plan.limits.members}`}
                  </p>
                  <p>
                    <span className="font-medium">Email campaigns:</span>{" "}
                    {plan.limits.emailCampaigns ? "Yes" : "No"}
                  </p>
                  <p>
                    <span className="font-medium">PDF export:</span>{" "}
                    {plan.limits.pdfExport ? "Yes" : "No"}
                  </p>
                  <p>
                    <span className="font-medium">Advanced reports:</span>{" "}
                    {plan.limits.advancedReports ? "Yes" : "No"}
                  </p>
                </div>

                <Link
                  href="/signup"
                  className={`mt-6 block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                    isPopular
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  Start free trial — {plan.name}
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
