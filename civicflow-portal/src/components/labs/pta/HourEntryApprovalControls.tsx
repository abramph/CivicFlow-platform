"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function HourEntryApprovalControls({ entryId, defaultMinutes }: { entryId: string; defaultMinutes: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "reject">("idle");
  const [adjustedHours, setAdjustedHours] = useState((defaultMinutes / 60).toString());
  const [showAdjust, setShowAdjust] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setPending(true);
    setError(null);
    try {
      const adjustedMinutes = showAdjust ? Math.round(Number(adjustedHours) * 60) : null;
      const res = await fetch(`/api/labs/pta/volunteers/hour-entries/${entryId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustedMinutes }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to approve.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      setError("A reason is required to reject.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/hour-entries/${entryId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to reject.");
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (mode === "reject") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejecting" className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        {error ? <span className="text-sm text-red-700">{error}</span> : null}
        <button type="button" disabled={pending} onClick={reject} className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
          {pending ? "Rejecting..." : "Confirm reject"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="text-sm font-semibold text-slate-600 hover:underline">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showAdjust ? (
        <label className="flex items-center gap-1 text-sm text-slate-700">
          Hours:
          <input value={adjustedHours} onChange={(e) => setAdjustedHours(e.target.value)} type="number" min={0} step="0.25" className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
        </label>
      ) : (
        <button type="button" onClick={() => setShowAdjust(true)} className="text-xs text-slate-500 underline">
          adjust before approving
        </button>
      )}
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      <button type="button" disabled={pending} onClick={approve} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Approving..." : "Approve"}
      </button>
      <button type="button" disabled={pending} onClick={() => setMode("reject")} className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
        Reject
      </button>
    </div>
  );
}
