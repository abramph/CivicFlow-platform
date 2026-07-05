"use client";

import { useEffect, useState } from "react";

interface SmsAddOnStatus {
  smsAddOnActive: boolean;
  smsMonthlyLimit: number;
  smsUsedThisPeriod: number;
  smsOverageRateCents: number;
  smsBillingPeriodEnd: string | null;
  monthlyPriceCents: number;
  includedMessagesPerMonth: number;
}

export function SmsAddOnCard({
  canManageBilling,
  hasActiveSubscription,
}: {
  canManageBilling: boolean;
  hasActiveSubscription: boolean;
}) {
  const [status, setStatus] = useState<SmsAddOnStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/billing/sms-addon");
    const data = await res.json();
    if (res.ok) setStatus(data.data);
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(enable: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/sms-addon", { method: enable ? "POST" : "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      await load();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!status) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm text-slate-500">Loading SMS add-on status…</p>
      </div>
    );
  }

  const remaining = Math.max(0, status.smsMonthlyLimit - status.smsUsedThisPeriod);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="font-semibold text-slate-900">SMS Add-on</p>
          <p className="mt-1 text-sm text-slate-600">
            Send dues reminders, announcements, and event notices by text message. $
            {(status.monthlyPriceCents / 100).toFixed(0)}/mo, includes{" "}
            {status.includedMessagesPerMonth.toLocaleString()} messages, then $
            {(status.smsOverageRateCents / 100).toFixed(2)}/message overage.
          </p>
        </div>
        <span
          className={`ml-4 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            status.smsAddOnActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {status.smsAddOnActive ? "Enabled" : "Disabled"}
        </span>
      </div>

      {status.smsAddOnActive ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">Monthly limit</p>
            <p className="text-lg font-semibold text-slate-900">{status.smsMonthlyLimit.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Used this period</p>
            <p className="text-lg font-semibold text-slate-900">{status.smsUsedThisPeriod.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Remaining</p>
            <p className="text-lg font-semibold text-slate-900">{remaining.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Overage rate</p>
            <p className="text-lg font-semibold text-slate-900">${(status.smsOverageRateCents / 100).toFixed(2)}/msg</p>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {canManageBilling ? (
        <div className="mt-4">
          {status.smsAddOnActive ? (
            <button
              onClick={() => toggle(false)}
              disabled={loading}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {loading ? "Working…" : "Disable SMS Add-on"}
            </button>
          ) : hasActiveSubscription ? (
            <button
              onClick={() => toggle(true)}
              disabled={loading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading ? "Working…" : "Enable SMS Add-on"}
            </button>
          ) : (
            <p className="text-sm text-slate-500">Subscribe to a paid plan first to add SMS.</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">Contact your org owner to manage the SMS add-on.</p>
      )}
    </div>
  );
}
