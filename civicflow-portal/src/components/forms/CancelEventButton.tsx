"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A dedicated cancel action, rather than requiring staff to open Edit and
 * type a status value by hand — that free-text path is exactly how an event
 * could end up with a typo'd status ("Canceled") that silently failed to
 * match the events-list "Upcoming / Active" filter's exact-string check.
 * This always writes the canonical "cancelled" value.
 */
export function CancelEventButton({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmCancel() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to cancel the event.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span>Cancel this event?</span>
        <button
          type="button"
          disabled={pending}
          onClick={confirmCancel}
          className="rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-60"
        >
          {pending ? "Cancelling..." : "Yes, cancel"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Never mind
        </button>
        {error ? <span className="text-red-700">{error}</span> : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      Cancel Event
    </button>
  );
}
