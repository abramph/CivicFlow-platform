"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ElectionType = "FULL_BUYOUT" | "PARTIAL_BUYOUT";
type PaymentMethod = "CASH" | "CHECK" | "ZELLE" | "CASH_APP" | "OTHER";

/** Volunteer Hour Requirements & Buyout program, VH-F — administrator
 * recording of an offline (cash/check/Zelle/CashApp/other) buyout payment.
 * Purchased-hour credit posts immediately since this form IS the
 * verification step (spec §7). */
export function PtaVolunteerOfflinePaymentForm({ periodId }: { periodId: string }) {
  const router = useRouter();
  const [householdId, setHouseholdId] = useState("");
  const [electionType, setElectionType] = useState<ElectionType>("PARTIAL_BUYOUT");
  const [hours, setHours] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CHECK");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/purchases/offline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId,
          electionType,
          ...(electionType === "PARTIAL_BUYOUT" ? { hoursElectedMinutes: Math.round(Number(hours || 0) * 60) } : {}),
          paymentMethod,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to record this payment.");
        return;
      }
      setSuccess(true);
      setHouseholdId("");
      setHours("");
      setReference("");
      setNotes("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Household id</span>
          <input value={householdId} onChange={(e) => setHouseholdId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Buyout type</span>
          <select value={electionType} onChange={(e) => setElectionType(e.target.value as ElectionType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="PARTIAL_BUYOUT">Partial (per-hour)</option>
            <option value="FULL_BUYOUT">Full buyout</option>
          </select>
        </label>
        {electionType === "PARTIAL_BUYOUT" ? (
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Hours purchased</span>
            <input type="number" min={0} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        ) : null}
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Payment method</span>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="CASH">Cash</option>
            <option value="CHECK">Check</option>
            <option value="ZELLE">Zelle</option>
            <option value="CASH_APP">Cash App</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Reference / confirmation # (optional)</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <button
        type="button"
        disabled={pending || !householdId.trim() || (electionType === "PARTIAL_BUYOUT" && !hours)}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        {pending ? "Recording..." : "Record payment"}
      </button>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-emerald-700">Payment recorded and hours credited.</p> : null}
    </div>
  );
}
