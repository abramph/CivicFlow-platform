"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface StripeView {
  statusLabel: string;
  onboardingStatus: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsCurrentlyDueCount: number;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  disabled: boolean;
  accountMode: string;
}

/** CONNECT-B (§5/§6/§24) — connection card. Returning from Stripe triggers a
 * provider-truth refresh; the redirect itself proves nothing. */
export function StripePaymentsCard({
  view,
  viewer,
}: {
  view: StripeView | null;
  viewer: { canConnect: boolean; canRefresh: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/stripe/refresh", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to refresh the Stripe status.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function connect() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/stripe/connect", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to start Stripe setup.");
        return;
      }
      window.location.href = data.data.url;
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  // §6: back from Stripe → sync provider truth once, then clean the URL.
  const stripeParam = searchParams.get("stripe");
  useEffect(() => {
    if (stripeParam && viewer.canRefresh && view) {
      refresh().then(() => router.replace("/settings/payments"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeParam]);

  if (!view) {
    return (
      <div className="space-y-3">
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
        <p className="text-sm text-slate-700">
          Your organization is not connected to Stripe yet. Connecting takes a few minutes — Stripe walks you through
          identity, business, and bank details.
        </p>
        {viewer.canConnect ? (
          <button
            type="button"
            disabled={pending}
            onClick={connect}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {pending ? "Preparing…" : "Connect Stripe"}
          </button>
        ) : (
          <p className="text-sm text-slate-500">An organization owner or admin can connect Stripe.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            view.disabled
              ? "bg-slate-200 text-slate-700"
              : view.chargesEnabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {view.statusLabel}
        </span>
        {view.accountMode === "test" ? (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">Test mode</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Payments</dt>
          <dd className="font-medium text-slate-900">{view.chargesEnabled ? "Enabled" : "Not enabled"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Payouts</dt>
          <dd className="font-medium text-slate-900">{view.payoutsEnabled ? "Enabled" : "Pending"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Requirements due</dt>
          <dd className="font-medium text-slate-900">{view.requirementsCurrentlyDueCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Connected since</dt>
          <dd className="font-medium text-slate-900">
            {view.connectedAt ? new Date(view.connectedAt).toLocaleDateString() : "—"}
          </dd>
        </div>
      </dl>
      {view.requirementsCurrentlyDueCount > 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Stripe needs additional information before your organization can accept payments.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {viewer.canConnect && !view.chargesEnabled && !view.disabled ? (
          <button
            type="button"
            disabled={pending}
            onClick={connect}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {view.onboardingStatus === "ONBOARDING_STARTED" ? "Continue Setup" : "Complete Stripe Setup"}
          </button>
        ) : null}
        <a
          href="https://dashboard.stripe.com"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Open Stripe
        </a>
        {viewer.canRefresh ? (
          <button
            type="button"
            disabled={pending}
            onClick={refresh}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh Status
          </button>
        ) : null}
      </div>
      {view.lastSyncedAt ? (
        <p className="text-xs text-slate-500">Status last checked {new Date(view.lastSyncedAt).toLocaleString()}.</p>
      ) : null}
    </div>
  );
}
