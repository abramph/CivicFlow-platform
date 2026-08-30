"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatOrgWallTime } from "@/lib/labs/pta/volunteer-hours/timezone";

type RateType = "FULL_BUYOUT" | "PER_HOUR" | "FINAL_ASSESSMENT";
type LockTiming = "ELECTION" | "CHECKOUT";

export interface PricingWindowLike {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  rateType: RateType;
  amountCents: number;
  contractSigningOnly: boolean;
  active: boolean;
  lockTiming: LockTiming;
}

const RATE_TYPE_LABEL: Record<RateType, string> = {
  FULL_BUYOUT: "Full buyout (flat total)",
  PER_HOUR: "Per-hour advance rate",
  FINAL_ASSESSMENT: "Final remaining-hour assessment rate",
};

function formatMoney(cents: number, rateType: RateType) {
  const amount = (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  return rateType === "FULL_BUYOUT" ? amount : `${amount}/hr`;
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-C (docs/pta-volunteer-hours.md).
 * Pricing-window CRUD. The server is the sole source of truth for the
 * resolved rate at checkout/assessment time (VH-F/VH-G) — this UI only
 * configures the windows, it never computes a price a client could submit.
 *
 * FC-6: `timezone` (the owning period's, passed from the server) is what
 * every displayed date/time is formatted in — showing the raw UTC-sliced
 * ISO string here would display the wrong wall-clock time back to the
 * admin for any non-UTC organization, even though the underlying stored
 * instant and its enforcement are correct.
 */
export function PtaVolunteerPricingWindowsManager({
  periodId,
  windows,
  canManage,
  timezone,
}: {
  periodId: string;
  windows: PricingWindowLike[];
  canManage: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [rateType, setRateType] = useState<RateType>("PER_HOUR");
  const [amount, setAmount] = useState("");
  // FC-10 (fix/pta-volunteer-financial-controls): contractSigningOnly is a
  // real column, but nothing in the server ever reads it — no code path
  // restricts a "first election only" window from being used for a later
  // top-up purchase. Rather than let an admin pick a restriction the
  // backend silently ignores, the control is removed from this form until
  // that enforcement is actually built; the value is always sent false.
  const contractSigningOnly = false;
  const [lockTiming, setLockTiming] = useState<LockTiming>("CHECKOUT");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWindow() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/pricing-windows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          startAt,
          endAt,
          rateType,
          amountCents: Math.round(Number(amount || 0) * 100),
          contractSigningOnly,
          lockTiming,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create pricing window.");
        return;
      }
      setName("");
      setStartAt("");
      setEndAt("");
      setAmount("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(window: PricingWindowLike) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/pricing-windows/${window.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: window.name,
          startAt: window.startAt,
          endAt: window.endAt,
          rateType: window.rateType,
          amountCents: window.amountCents,
          contractSigningOnly: window.contractSigningOnly,
          active: !window.active,
          lockTiming: window.lockTiming,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update pricing window.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function removeWindow(windowId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/pricing-windows/${windowId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to remove pricing window.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {windows.length === 0 ? (
        <p className="text-sm text-slate-600">No pricing windows yet — families can&apos;t buy out hours until at least one exists.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {windows.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-2">
              <div className="text-sm">
                <span className="font-medium text-slate-900">{w.name}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${w.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
                  {w.active ? "Active" : "Inactive"}
                </span>
                <p className="text-xs text-slate-500">
                  {RATE_TYPE_LABEL[w.rateType]} · {formatMoney(w.amountCents, w.rateType)} · {formatOrgWallTime(w.startAt, timezone, true).replace("T", " ")} –{" "}
                  {formatOrgWallTime(w.endAt, timezone, true).replace("T", " ")}
                  {w.contractSigningOnly ? " · marked “initial election only” (not currently enforced — every election can use this rate)" : ""} · rate locks at{" "}
                  {w.lockTiming === "ELECTION" ? "election (frozen when the family elects, until the window closes)" : "checkout (re-quoted at the currently active rate when checkout starts)"}
                </p>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggleActive(w)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {w.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => removeWindow(w.id)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="text-sm font-semibold text-slate-900">Add a pricing window</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Window name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Early rate" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Rate type</span>
              <select value={rateType} onChange={(e) => setRateType(e.target.value as RateType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {(Object.keys(RATE_TYPE_LABEL) as RateType[]).map((t) => (
                  <option key={t} value={t}>
                    {RATE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Starts at</span>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <span className="block text-xs font-normal text-slate-500">Organization&apos;s local time ({timezone}), inclusive — the rate is active starting exactly this moment.</span>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Ends at</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <span className="block text-xs font-normal text-slate-500">
                Organization&apos;s local time ({timezone}), exclusive — the rate stops being active exactly this
                moment. To close a window at the end of a calendar day, set the time to 23:59.
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>{rateType === "FULL_BUYOUT" ? "Flat total ($)" : "Per-hour rate ($)"}</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Rate locks at</span>
              <select value={lockTiming} onChange={(e) => setLockTiming(e.target.value as LockTiming)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="CHECKOUT">Checkout (family is charged the rate active when they start checkout, even if it changed since they elected)</option>
                <option value="ELECTION">Election (family&apos;s rate is frozen the moment they acknowledge their election, and honored at checkout as long as this window is still open)</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500">
            No charge occurs merely from configuring a pricing window, from a family electing an option, or from previewing a quote — a charge only
            happens when a family completes checkout or an administrator records an offline payment.
          </p>
          <button
            type="button"
            disabled={pending || !name.trim() || !startAt || !endAt}
            onClick={createWindow}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Add pricing window"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
