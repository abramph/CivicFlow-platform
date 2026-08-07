"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { computeOrgWhatsAppCharges } from "@/lib/whatsapp/admin-pricing";

interface OrgRow {
  id: string;
  name: string;
  whatsappAddOnActive: boolean;
  whatsappMonthlyLimit: number;
  whatsappUsedThisPeriod: number;
  whatsappOverageRateCents: number;
  suspendedAt: string | null;
  pilotMode: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
}

function centsToDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function OrgRowActions({ org }: { org: OrgRow }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState(String(org.whatsappMonthlyLimit));
  const [overageDraft, setOverageDraft] = useState(String(org.whatsappOverageRateCents));
  const [pauseReasonDraft, setPauseReasonDraft] = useState(org.pauseReason ?? "");
  const [startHourDraft, setStartHourDraft] = useState(String(org.quietHoursStartHour));
  const [endHourDraft, setEndHourDraft] = useState(String(org.quietHoursEndHour));

  async function put(body: Record<string, unknown>, key: string) {
    setPending(key);
    setError(null);
    try {
      const res = await fetch(`/api/admin/whatsapp/organizations/${org.id}`, {
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
      const res = await fetch(`/api/admin/whatsapp/organizations/${org.id}/reset-usage`, { method: "POST" });
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

  const charge = computeOrgWhatsAppCharges({
    whatsappMonthlyLimit: org.whatsappMonthlyLimit,
    whatsappUsedThisPeriod: org.whatsappUsedThisPeriod,
    whatsappOverageRateCents: org.whatsappOverageRateCents,
  });

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-4 py-3 font-semibold text-slate-900">{org.name}</td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={pending === "whatsappAddOnActive"}
          onClick={() => put({ whatsappAddOnActive: !org.whatsappAddOnActive }, "whatsappAddOnActive")}
          className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
            org.whatsappAddOnActive ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
          }`}
        >
          {org.whatsappAddOnActive ? "Enabled" : "Disabled"}
        </button>
      </td>
      <td className="px-4 py-3 text-slate-900">
        {org.whatsappUsedThisPeriod} / {org.whatsappMonthlyLimit}
      </td>
      <td className="px-4 py-3">
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
          <button
            type="button"
            disabled={pending === "limits"}
            onClick={() =>
              put(
                { whatsappMonthlyLimit: Number(limitDraft) || 0, whatsappOverageRateCents: Number(overageDraft) || 0 },
                "limits"
              )
            }
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            Save
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">Est. charge: {centsToDollars(charge.totalChargeCents)}</p>
      </td>
      <td className="px-4 py-3">
        <button
          type="button"
          disabled={pending === "pilotMode"}
          onClick={() => put({ pilotMode: !org.pilotMode }, "pilotMode")}
          className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60 ${
            org.pilotMode ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {org.pilotMode ? "Pilot" : "Promoted (GA)"}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={23}
            value={startHourDraft}
            onChange={(e) => setStartHourDraft(e.target.value)}
            className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
            aria-label="Quiet hours start"
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="number"
            min={0}
            max={23}
            value={endHourDraft}
            onChange={(e) => setEndHourDraft(e.target.value)}
            className="w-14 rounded border border-slate-300 px-1.5 py-1 text-xs"
            aria-label="Quiet hours end"
          />
          <button
            type="button"
            disabled={pending === "quietHours"}
            onClick={() =>
              put(
                { quietHoursStartHour: Number(startHourDraft) || 0, quietHoursEndHour: Number(endHourDraft) || 0 },
                "quietHours"
              )
            }
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </td>
      <td className="px-4 py-3">
        {org.suspendedAt ? (
          <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">Suspended</span>
        ) : org.pausedAt ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800" title={org.pauseReason ?? undefined}>
            Paused
          </span>
        ) : org.whatsappAddOnActive ? (
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
        <div className="mt-2 flex items-center gap-1">
          <input
            type="text"
            placeholder="Pause reason"
            value={pauseReasonDraft}
            onChange={(e) => setPauseReasonDraft(e.target.value)}
            className="w-28 rounded border border-slate-300 px-1.5 py-1 text-xs"
          />
          <button
            type="button"
            disabled={pending === "pause"}
            onClick={() => put({ paused: !org.pausedAt, pauseReason: org.pausedAt ? null : pauseReasonDraft || null }, "pause")}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {org.pausedAt ? "Resume" : "Pause"}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
      </td>
    </tr>
  );
}

export function WhatsAppOrganizationsTable({ organizations }: { organizations: OrgRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-700">
          <tr>
            <th className="px-4 py-3">Organization</th>
            <th className="px-4 py-3">WhatsApp Enabled</th>
            <th className="px-4 py-3">Monthly Usage</th>
            <th className="px-4 py-3">Limit / Overage</th>
            <th className="px-4 py-3">Rollout</th>
            <th className="px-4 py-3">Quiet Hours</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {organizations.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-6 text-center text-slate-600">
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
