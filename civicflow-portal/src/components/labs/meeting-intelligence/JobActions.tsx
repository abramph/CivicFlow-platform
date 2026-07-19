"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JobActions({ jobId, status, retryAvailable }: { jobId: string; status: string; retryAvailable: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, key: string) {
    setPending(key);
    setError(null);
    try {
      const response = await fetch(`/api/labs/meeting-intelligence/jobs/${jobId}${path}`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Action failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const canCancel = !["APPROVED", "CANCELLED", "DELETED"].includes(status);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {retryAvailable ? (
          <button
            type="button"
            disabled={pending === "retry"}
            onClick={() => post("/retry", "retry")}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending === "retry" ? "Retrying..." : "Retry"}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={pending === "cancel"}
            onClick={() => post("/cancel", "cancel")}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {pending === "cancel" ? "Cancelling..." : "Cancel"}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
