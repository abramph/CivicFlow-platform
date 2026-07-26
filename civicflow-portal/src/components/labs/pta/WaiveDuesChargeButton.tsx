"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function WaiveDuesChargeButton({ householdId, chargeId }: { householdId: string; chargeId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/households/${householdId}/dues/${chargeId}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to waive this charge.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50">
        Waive
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. financial hardship)"
        className="w-64 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
      />
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      <button type="button" disabled={pending} onClick={submit} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60">
        {pending ? "Waiving..." : "Confirm waive"}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
        Cancel
      </button>
    </div>
  );
}
