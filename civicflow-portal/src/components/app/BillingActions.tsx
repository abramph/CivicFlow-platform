"use client";

import { useState } from "react";

type Plan = "essential" | "elite";

interface UpgradeButtonProps {
  plan: Plan;
  currentPlan: string;
  label?: string;
}

export function UpgradeButton({ plan, currentPlan, label }: UpgradeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrentPlan = currentPlan === plan;

  async function handleClick() {
    if (isCurrentPlan) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Unable to connect. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading || isCurrentPlan}
        className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
          isCurrentPlan
            ? "cursor-default bg-slate-100 text-slate-500"
            : "bg-emerald-600 text-white hover:bg-emerald-700"
        }`}
      >
        {isCurrentPlan
          ? "Current plan"
          : loading
            ? "Redirecting…"
            : label ?? `Upgrade to ${plan.charAt(0).toUpperCase() + plan.slice(1)}`}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

interface ManageBillingButtonProps {
  hasSubscription: boolean;
}

export function ManageBillingButton({ hasSubscription }: ManageBillingButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasSubscription) return null;

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to open billing portal.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Unable to connect. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Manage subscription"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : null}
    </div>
  );
}
