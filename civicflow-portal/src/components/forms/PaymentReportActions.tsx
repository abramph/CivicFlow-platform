"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/payment-reports/${reportId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to approve payment report.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/payment-reports/${reportId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason: rejectionReason.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to reject payment report.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (showReject) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          rows={2}
          placeholder="Reason for rejection"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
        {error ? <p className="text-xs text-red-700">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={reject}
            className="rounded-lg bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-400"
          >
            {busy ? "Rejecting..." : "Confirm Reject"}
          </button>
          <button type="button" onClick={() => setShowReject(false)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={approve}
          className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400"
        >
          {busy ? "Approving..." : "Approve"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setShowReject(true)}
          className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
