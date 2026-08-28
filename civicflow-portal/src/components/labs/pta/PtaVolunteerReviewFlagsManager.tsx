"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ReviewFlagLike {
  id: string;
  flagType: "CORRECTION_AFTER_ASSESSMENT_POSTED" | "POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED" | "REFUND_CREATES_DEFICIT";
  description: string;
  status: "OPEN" | "RESOLVED";
  resolutionNotes: string | null;
  createdAt: string;
}

const FLAG_TYPE_LABEL: Record<ReviewFlagLike["flagType"], string> = {
  CORRECTION_AFTER_ASSESSMENT_POSTED: "Correction after assessment posted",
  POTENTIAL_OVERPAYMENT_AFTER_REQUIREMENT_REDUCED: "Potential overpayment",
  REFUND_CREATES_DEFICIT: "Refund creates a deficit",
};

/** Volunteer Hour Requirements & Buyout program, VH-H — surfaces the cases
 * spec §21 requires a human to review rather than resolving automatically
 * (a correction after an assessment posted, a possible overpayment after a
 * requirement was reduced, or a refund that leaves a family short). Nothing
 * here charges or refunds anything — resolving just acknowledges review. */
export function PtaVolunteerReviewFlagsManager({ periodId, flags }: { periodId: string; flags: ReviewFlagLike[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function resolve(flagId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/review-flags/${flagId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolutionNotes: notes[flagId] ?? null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to resolve this flag.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const open = flags.filter((f) => f.status === "OPEN");
  const resolved = flags.filter((f) => f.status === "RESOLVED");

  if (flags.length === 0) {
    return <p className="text-sm text-slate-600">No review flags for this period.</p>;
  }

  return (
    <div className="space-y-4">
      {open.length > 0 ? (
        <ul className="space-y-2">
          {open.map((flag) => (
            <li key={flag.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{FLAG_TYPE_LABEL[flag.flagType]}</p>
              <p className="mt-1 text-sm text-slate-900">{flag.description}</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  placeholder="Resolution notes (optional)"
                  value={notes[flag.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [flag.id]: e.target.value })}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => resolve(flag.id)}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  Mark reviewed
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No open flags.</p>
      )}
      {resolved.length > 0 ? (
        <details className="text-sm text-slate-600">
          <summary className="cursor-pointer font-medium">{resolved.length} resolved</summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((flag) => (
              <li key={flag.id} className="text-xs">
                {FLAG_TYPE_LABEL[flag.flagType]} — {flag.description}
                {flag.resolutionNotes ? ` (${flag.resolutionNotes})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
