"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DisputeLike {
  id: string;
  householdId: string;
  description: string;
  status: "OPEN" | "RESOLVED" | "DISMISSED";
  adminNotes: string | null;
  createdAt: string;
}

const STATUS_BADGE: Record<DisputeLike["status"], string> = {
  OPEN: "bg-amber-100 text-amber-800",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  DISMISSED: "bg-slate-100 text-slate-500",
};

/** Volunteer Hour Requirements & Buyout program, VH-E — admin view of
 * family-submitted "missing or incorrect hours" reports. Resolving here
 * only changes the report's status; any actual hour correction goes
 * through the existing approve/reject/adjust tools. */
export function PtaVolunteerDisputesManager({ periodId, disputes }: { periodId: string; disputes: DisputeLike[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  async function resolve(disputeId: string, status: "RESOLVED" | "DISMISSED") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/disputes/${disputeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminNotes: notesById[disputeId] ?? null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update this report.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (disputes.length === 0) {
    return <p className="text-sm text-slate-600">No family-reported issues for this period.</p>;
  }

  return (
    <div className="space-y-3">
      {disputes.map((d) => (
        <div key={d.id} className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[d.status]}`}>{d.status}</span>
            <span className="text-xs text-slate-500">{d.createdAt.slice(0, 10)}</span>
          </div>
          <p className="mt-2 text-sm text-slate-900">{d.description}</p>
          {d.adminNotes ? <p className="mt-1 text-xs text-slate-500">Notes: {d.adminNotes}</p> : null}
          {d.status === "OPEN" ? (
            <div className="mt-2 space-y-2">
              <input
                value={notesById[d.id] ?? ""}
                onChange={(e) => setNotesById({ ...notesById, [d.id]: e.target.value })}
                placeholder="Resolution notes (optional)"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => resolve(d.id, "RESOLVED")}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => resolve(d.id, "DISMISSED")}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
