"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AssessmentLineLike {
  id: string;
  householdId: string;
  household: { displayName: string };
  adjustedRequiredMinutes: number;
  verifiedMinutes: number;
  purchasedMinutes: number;
  remainingMinutes: number;
  assessmentCents: number;
  status: "INCLUDED" | "EXCLUDED" | "POSTED";
  excludeReason: string | null;
}

export interface AssessmentBatchLike {
  id: string;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  rateCents: number;
  createdAt: string;
  lines: AssessmentLineLike[];
}

function hours(minutes: number) {
  return (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/** Volunteer Hour Requirements & Buyout program, VH-G — the assessment
 * preview/exclude/post workflow (spec §18). */
export function PtaVolunteerAssessmentManager({ periodId, draftBatch }: { periodId: string; draftBatch: AssessmentBatchLike | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excludeReasons, setExcludeReasons] = useState<Record<string, string>>({});

  async function runPreview() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate a preview.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function setLineStatus(lineId: string, status: "INCLUDED" | "EXCLUDED") {
    if (!draftBatch) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assessments/${draftBatch.id}/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: excludeReasons[lineId] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update this family.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function postBatch() {
    if (!draftBatch) return;
    if (!window.confirm(`Post this assessment batch? This will charge ${draftBatch.lines.filter((l) => l.status === "INCLUDED").length} families.`)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assessments/${draftBatch.id}/post`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to post this batch.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function cancelBatch() {
    if (!draftBatch) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assessments/${draftBatch.id}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to cancel this batch.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const includedTotal = draftBatch?.lines.filter((l) => l.status === "INCLUDED").reduce((sum, l) => sum + l.assessmentCents, 0) ?? 0;

  return (
    <div className="space-y-4">
      {!draftBatch ? (
        <button
          type="button"
          disabled={pending}
          onClick={runPreview}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Generating..." : "Preview remaining-hours assessment"}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Rate: {money(draftBatch.rateCents)}/hr · {draftBatch.lines.length} families with hours remaining · Total if posted as-is:{" "}
            <strong>{money(includedTotal)}</strong>
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Family</th>
                  <th className="py-2 pr-4">Required</th>
                  <th className="py-2 pr-4">Verified</th>
                  <th className="py-2 pr-4">Purchased</th>
                  <th className="py-2 pr-4">Remaining</th>
                  <th className="py-2 pr-4">Assessment</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {draftBatch.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="py-2 pr-4 font-medium text-slate-900">{line.household.displayName}</td>
                    <td className="py-2 pr-4">{hours(line.adjustedRequiredMinutes)}h</td>
                    <td className="py-2 pr-4">{hours(line.verifiedMinutes)}h</td>
                    <td className="py-2 pr-4">{hours(line.purchasedMinutes)}h</td>
                    <td className="py-2 pr-4">{hours(line.remainingMinutes)}h</td>
                    <td className="py-2 pr-4">{money(line.assessmentCents)}</td>
                    <td className="py-2 pr-4">{line.status}</td>
                    <td className="py-2 pr-4">
                      {line.status !== "POSTED" ? (
                        line.status === "INCLUDED" ? (
                          <div className="flex items-center gap-1">
                            <input
                              placeholder="Reason"
                              value={excludeReasons[line.id] ?? ""}
                              onChange={(e) => setExcludeReasons({ ...excludeReasons, [line.id]: e.target.value })}
                              className="w-28 rounded border border-slate-300 px-1.5 py-1 text-xs"
                            />
                            <button
                              type="button"
                              disabled={pending || !excludeReasons[line.id]?.trim()}
                              onClick={() => setLineStatus(line.id, "EXCLUDED")}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                            >
                              Exclude
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setLineStatus(line.id, "INCLUDED")}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                          >
                            Include
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draftBatch.status === "DRAFT" ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={postBatch}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {pending ? "Posting..." : "Confirm and post assessment"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={cancelBatch}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel batch
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-emerald-700">This batch has been posted.</p>
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
