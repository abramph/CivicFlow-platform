"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Eligibility {
  organizationName: string;
  eligible: boolean;
  ineligibleReason: string | null;
  billingExempt: boolean;
  currentAccessAllowed: boolean;
  fixedDurationDays: number;
}

interface GrantResult {
  trialStartsAt: string;
  trialExpiresAt: string;
  accessActive: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Platform Admin control for granting a one-time, 30-day, Stripe-free
 * internal trial (docs/internal-trial-grants.md). Same preview-then-confirm
 * shape as PrimaryVerticalManager, but the preview loads automatically on
 * mount (there's no target to pick — the action is binary) and the control
 * simply doesn't render once a trial has already been granted or used,
 * because checkInternalTrialEligibility() already reports that as
 * ineligible with a specific reason.
 */
export function InternalTrialManager({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GrantResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEligibility() {
      setLoadingEligibility(true);
      try {
        const res = await fetch(`/api/admin/organizations/${organizationId}/internal-trial`);
        const data = await res.json().catch(() => null);
        if (!cancelled && res.ok && data?.ok) {
          setEligibility(data.data);
        }
      } finally {
        if (!cancelled) setLoadingEligibility(false);
      }
    }
    loadEligibility();
    return () => {
      cancelled = true;
    };
  }, [organizationId, result]);

  async function confirmGrant() {
    if (!reason.trim()) {
      setError("A reason is required to grant an internal trial.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/internal-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim(), confirm: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to grant the internal trial.");
        return;
      }
      setResult(data.data);
      setConfirming(false);
      setReason("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingEligibility) {
    return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Checking internal trial eligibility…</div>;
  }

  if (result) {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-semibold">Internal trial active</p>
        <p>Start: {formatDate(result.trialStartsAt)}</p>
        <p>Ends: {formatDate(result.trialExpiresAt)}</p>
        <p className="text-xs text-emerald-700">Recorded in the audit log (platform.organization.internal_trial_granted). No Stripe subscription or charge was created.</p>
      </div>
    );
  }

  // Do not show the action when clearly ineligible — the eligibility check
  // (billingExempt, active Subscription, already-used-or-active trial,
  // inactive org) is enforced server-side regardless, but there's no reason
  // to present a confirm flow that the API will only reject.
  if (!eligibility || !eligibility.eligible) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Internal trial not available{eligibility?.ineligibleReason ? `: ${eligibility.ineligibleReason}` : "."}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Internal Trial</p>
          <p className="text-xs text-slate-500">{eligibility.organizationName} currently has no active access entitlement.</p>
        </div>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Grant 30-Day Internal Trial
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {confirming ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            This grants <strong>{eligibility.organizationName}</strong> exactly <strong>{eligibility.fixedDurationDays} days</strong> of
            application access, ending {formatDate(new Date(Date.now() + eligibility.fixedDurationDays * 86_400_000).toISOString())}.
          </p>
          <p>No Stripe subscription, Checkout Session, payment method, or automatic charge will be created.</p>
          <p className="font-semibold">
            This is a one-time entitlement — once used, this organization cannot receive another standard internal trial.
          </p>

          <label className="block space-y-1 text-xs font-medium text-amber-900">
            <span>
              Reason <span className="text-red-700">(required — recorded in the audit log)</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !reason.trim()}
              onClick={confirmGrant}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {saving ? "Granting…" : "Confirm Grant"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
