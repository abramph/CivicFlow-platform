"use client";

import { useState } from "react";
import type { BillingInterval } from "@/lib/plans";

interface SubscribeButtonProps {
  /** Whether the org is already subscribed at this exact interval — the
   * only "current plan" state left, since Unestra Cloud has one plan per
   * vertical rather than a tier to pick between (see CLOUD-D). */
  isCurrentSelection: boolean;
  interval: BillingInterval;
  label?: string;
}

/**
 * Unestra Cloud (CLOUD-D): the client sends only the billing interval —
 * never a plan id. The server resolves which Cloud plan applies entirely
 * from the organization's own primaryVertical (see
 * /api/billing/checkout/route.ts) — there is no client input path that
 * could select a different vertical's price.
 *
 * CLOUD-I: no seat quantity is ever sent — administrative seats are never
 * a paid add-on.
 */
export function SubscribeButton({ isCurrentSelection, interval, label }: SubscribeButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (isCurrentSelection) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
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
        disabled={loading || isCurrentSelection}
        className={`w-full rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${
          isCurrentSelection
            ? "cursor-default bg-slate-100 text-slate-500"
            : "bg-emerald-600 text-white hover:bg-emerald-700"
        }`}
      >
        {isCurrentSelection ? "Current plan" : loading ? "Redirecting…" : (label ?? "Subscribe")}
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
