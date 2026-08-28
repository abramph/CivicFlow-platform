"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RateType = "FULL_BUYOUT" | "PER_HOUR" | "FINAL_ASSESSMENT";
type LockTiming = "CHECKOUT_START" | "PAYMENT_SUCCESS";

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

function toDatetimeLocalValue(iso: string): string {
  return iso.slice(0, 16);
}

function formatMoney(cents: number, rateType: RateType) {
  const amount = (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
  return rateType === "FULL_BUYOUT" ? amount : `${amount}/hr`;
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-C (docs/pta-volunteer-hours.md).
 * Pricing-window CRUD. The server is the sole source of truth for the
 * resolved rate at checkout/assessment time (VH-F/VH-G) — this UI only
 * configures the windows, it never computes a price a client could submit.
 */
export function PtaVolunteerPricingWindowsManager({
  periodId,
  windows,
  canManage,
}: {
  periodId: string;
  windows: PricingWindowLike[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [rateType, setRateType] = useState<RateType>("PER_HOUR");
  const [amount, setAmount] = useState("");
  const [contractSigningOnly, setContractSigningOnly] = useState(false);
  const [lockTiming, setLockTiming] = useState<LockTiming>("PAYMENT_SUCCESS");
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
                  {RATE_TYPE_LABEL[w.rateType]} · {formatMoney(w.amountCents, w.rateType)} · {toDatetimeLocalValue(w.startAt).replace("T", " ")} –{" "}
                  {toDatetimeLocalValue(w.endAt).replace("T", " ")}
                  {w.contractSigningOnly ? " · initial election only" : ""} · rate locks at{" "}
                  {w.lockTiming === "CHECKOUT_START" ? "checkout" : "payment success"}
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
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Ends at</span>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>{rateType === "FULL_BUYOUT" ? "Flat total ($)" : "Per-hour rate ($)"}</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Rate locks at</span>
              <select value={lockTiming} onChange={(e) => setLockTiming(e.target.value as LockTiming)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="PAYMENT_SUCCESS">Payment success (re-quoted if payment is delayed)</option>
                <option value="CHECKOUT_START">Checkout start (frozen the moment checkout begins)</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={contractSigningOnly} onChange={(e) => setContractSigningOnly(e.target.checked)} className="h-4 w-4" />
            <span>Only offer during a family&apos;s first election (not for later top-up purchases)</span>
          </label>
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
