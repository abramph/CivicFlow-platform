"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { computeOrgSmsCharges, SMS_PLAN_TIERS, type SmsPlanId } from "@/lib/sms-admin-pricing";

interface OrgRow {
  id: string;
  name: string;
  smsAddOnActive: boolean;
  plan: string | null;
  planPriceCents: number;
  smsMonthlyLimit: number;
  smsUsedThisPeriod: number;
  smsOverageRateCents: number;
  suspendedAt: string | null;
}

function centsToDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function OrgRowActions({ org }: { org: OrgRow }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState(String(org.smsMonthlyLimit));
  const [overageDraft, setOverageDraft] = useState(String(org.smsOverageRateCents));
  const [priceDraft, setPriceDraft] = useState(String(org.planPriceCents));

  async function put(body: Record<string, unknown>, key: string) {
    setPending(key);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sms/organizations/${org.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save changes.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect.");
    } finally {
      setPending(null);
    }
  }

  async function resetUsage() {
    setPending("reset");
    setError(null);
    try {
      const res = await fetch(`/api/admin/sms/organizations/${org.id}/reset-usage`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to reset usage.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect.");
    } finally {
      setPending(null);
    }
  }

  const charge = computeOrgSmsCharges({
    smsMonthlyLimit: org.smsMonthlyLimit,
    smsUsedThisPeriod: org.smsUsedThisPeriod,
    smsOverageRateCents: org.smsOverageRateCents,
    planPriceCents: org.planPriceCents,
  });

  const isEnterprise = org.plan === "ENTERPRISE";

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3 font-semibold text-slate-900">{org.name}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={pending === "smsAddOnActive"}
          onClick={() => put({ smsAddOnActive: !org.smsAddOnActive }, "smsAddOnActive")}
          className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
            org.smsAddOnActive ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
          }`}
        >
          {org.smsAddOnActive ? "Enabled" : "Disabled"}
        </button>
      </td>
      <td className="px-4 py-3">
        <select
          value={org.plan ?? "STARTER"}
          disabled={pending === "plan"}
          onChange={(e) => put({ plan: e.target.value as SmsPlanId }, "plan")}
          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
        >
          {Object.values(SMS_PLAN_TIERS).map((tier) => (
            <option key={tier.id} value={tier.id}>
              {tier.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-slate-900">
        {org.smsUsedThisPeriod} / {org.smsMonthlyLimit}
      </td>
      <td className="px-4 py-3">
        {isEnterprise ? (
          <div className="flex flex-wrap items-center gap-1">
            <input
              type="number"
              value={limitDraft}
              onChange={(e) => setLimitDraft(e.target.value)}
              className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs"
              aria-label="Monthly limit"
            />
            <input
              type="number"
              step="0.1"
              value={overageDraft}
              onChange={(e) => setOverageDraft(e.target.value)}
              className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs"
              aria-label="Overage rate (cents)"
              title="Overage rate, in cents per message"
            />
            <input
              type="number"
              value={priceDraft}
              onChange={(e) => setPriceDraft(e.target.value)}
              className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs"
              aria-label="Plan price (cents)"
              title="Monthly plan price, in cents"
            />
            <button
              type="button"
              disabled={pending === "limits"}
              onClick={() =>
                put(
                  {
                    smsMonthlyLimit: Number(limitDraft) || 0,
                    smsOverageRateCents: Number(overageDraft) || 0,
                    planPriceCents: Number(priceDraft) || 0,
                  },
                  "limits"
                )
              }
              className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Save
            </button>
          </div>
        ) : (
          <span className="text-slate-700">{centsToDollars(charge.totalChargeCents)}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {org.suspendedAt ? (
          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Suspended</span>
        ) : org.smsAddOnActive ? (
          <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">Active</span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Not Enabled</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending === "suspend"}
            onClick={() => put({ suspended: !org.suspendedAt }, "suspend")}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {org.suspendedAt ? "Unsuspend" : "Suspend"}
          </button>
          <button
            type="button"
            disabled={pending === "reset"}
            onClick={resetUsage}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            Reset Usage
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>
    </tr>
  );
}

export function SmsOrganizationsTable({ organizations }: { organizations: OrgRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-700">
          <tr>
            <th className="px-4 py-3">Organization</th>
            <th className="px-4 py-3">SMS Enabled</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3">Monthly Usage</th>
            <th className="px-4 py-3">Charges</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {organizations.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-slate-600">
                No organizations found.
              </td>
            </tr>
          ) : (
            organizations.map((org) => <OrgRowActions key={org.id} org={org} />)
          )}
        </tbody>
      </table>
    </div>
  );
}
