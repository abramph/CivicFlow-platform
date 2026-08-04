"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StatusValue =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "CHANGES_REQUESTED"
  | "RESUBMITTED"
  | "APPROVED"
  | "CONDITIONALLY_APPROVED"
  | "DENIED"
  | "WITHDRAWN"
  | "EXPIRED";

// Mirrors the state machine in src/lib/hoa/architectural-requests.ts
// (assertValidTransition) -- kept in sync manually since this is a client
// component and can't import server-only code; a mismatch here only
// affects which buttons are OFFERED, never what's actually allowed (the
// API route re-validates independently).
const NEXT_STEPS: Record<StatusValue, { value: StatusValue; label: string; tier: "review" | "decide" }[]> = {
  DRAFT: [],
  SUBMITTED: [{ value: "IN_REVIEW", label: "Move to review", tier: "review" }],
  IN_REVIEW: [
    { value: "CHANGES_REQUESTED", label: "Request changes", tier: "review" },
    { value: "APPROVED", label: "Approve", tier: "decide" },
    { value: "CONDITIONALLY_APPROVED", label: "Approve with conditions", tier: "decide" },
    { value: "DENIED", label: "Deny", tier: "decide" },
  ],
  CHANGES_REQUESTED: [],
  RESUBMITTED: [{ value: "IN_REVIEW", label: "Move to review", tier: "review" }],
  APPROVED: [{ value: "EXPIRED", label: "Mark expired", tier: "decide" }],
  CONDITIONALLY_APPROVED: [{ value: "EXPIRED", label: "Mark expired", tier: "decide" }],
  DENIED: [],
  WITHDRAWN: [],
  EXPIRED: [],
};

export function ArchitecturalRequestActions({
  requestId,
  status,
  canReview,
  canDecide,
}: {
  requestId: string;
  status: string;
  canReview: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [decisionSummary, setDecisionSummary] = useState("");
  const [conditions, setConditions] = useState("");

  async function transition(toStatus: StatusValue) {
    const isDecision = toStatus === "APPROVED" || toStatus === "CONDITIONALLY_APPROVED" || toStatus === "DENIED";
    setPending(toStatus);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/architectural-requests/${requestId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus,
          notes: notes || null,
          decisionSummary: isDecision ? decisionSummary || null : undefined,
          conditions: toStatus === "CONDITIONALLY_APPROVED" ? conditions || null : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update the request.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  const steps = NEXT_STEPS[status as StatusValue] ?? [];
  const availableSteps = steps.filter((s) => (s.tier === "decide" ? canDecide : canReview));

  if (availableSteps.length === 0) {
    return <p className="text-sm text-slate-600">No further action is available — this request is in a terminal or unauthorized state for your role.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (internal, optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {availableSteps.some((s) => s.tier === "decide") ? (
        <>
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Decision summary (resident-visible — required for a decision)</span>
            <textarea
              value={decisionSummary}
              onChange={(e) => setDecisionSummary(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Conditions (resident-visible — only used for &quot;Approve with conditions&quot;)</span>
            <textarea
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {availableSteps.map((s) => (
          <button
            key={s.value}
            type="button"
            disabled={pending === s.value}
            onClick={() => transition(s.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending === s.value ? "Saving…" : s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArchitecturalRequestCommentForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/architectural-requests/${requestId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, isPrivate }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add comment.");
        return;
      }
      setBody("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Add a comment</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="rounded border-slate-300" />
        Private (board/committee-only — uncheck to make this visible to the resident)
      </label>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Posting…" : "Add comment"}
      </button>
    </div>
  );
}
