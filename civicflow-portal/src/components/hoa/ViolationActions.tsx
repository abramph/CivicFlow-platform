"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ViolationStatusValue = "DRAFT" | "ISSUED" | "ACKNOWLEDGED" | "IN_REVIEW" | "CURED" | "RESOLVED" | "DISMISSED";

// Mirrors the state machine in src/lib/hoa/violations.ts (assertValidTransition)
// -- kept in sync manually since this is a client component and can't import
// server-only code; a mismatch here only affects which buttons are OFFERED,
// never what's actually allowed (the API route re-validates independently).
const NEXT_STEPS: Record<ViolationStatusValue, { value: ViolationStatusValue; label: string; tier: "review" | "resolve" }[]> = {
  DRAFT: [],
  ISSUED: [
    { value: "ACKNOWLEDGED", label: "Mark acknowledged", tier: "review" },
    { value: "IN_REVIEW", label: "Move to review", tier: "review" },
    { value: "CURED", label: "Mark cured", tier: "review" },
    { value: "DISMISSED", label: "Dismiss", tier: "resolve" },
  ],
  ACKNOWLEDGED: [
    { value: "IN_REVIEW", label: "Move to review", tier: "review" },
    { value: "CURED", label: "Mark cured", tier: "review" },
    { value: "DISMISSED", label: "Dismiss", tier: "resolve" },
  ],
  IN_REVIEW: [
    { value: "CURED", label: "Mark cured", tier: "review" },
    { value: "RESOLVED", label: "Resolve", tier: "resolve" },
    { value: "DISMISSED", label: "Dismiss", tier: "resolve" },
  ],
  CURED: [],
  RESOLVED: [],
  DISMISSED: [],
};

export function ViolationActions({
  violationId,
  status,
  cureByDate,
  canWrite,
  canReview,
  canResolve,
}: {
  violationId: string;
  status: string;
  cureByDate: string;
  canWrite: boolean;
  canReview: boolean;
  canResolve: boolean;
}) {
  const router = useRouter();
  const [noticeBody, setNoticeBody] = useState("");
  const [issueCureByDate, setIssueCureByDate] = useState(cureByDate);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [transitionNotes, setTransitionNotes] = useState("");

  async function issue() {
    setPending("issue");
    setError(null);
    try {
      const res = await fetch(`/api/hoa/violations/${violationId}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeBody, cureByDate: issueCureByDate ? new Date(issueCureByDate).toISOString() : null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to issue violation notice.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function transition(toStatus: ViolationStatusValue) {
    const terminal = toStatus === "CURED" || toStatus === "RESOLVED" || toStatus === "DISMISSED";
    setPending(toStatus);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/violations/${violationId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus,
          notes: transitionNotes || null,
          resolutionNotes: terminal ? resolutionNotes || null : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update the violation.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(null);
    }
  }

  if (status === "DRAFT") {
    if (!canWrite) return null;
    return (
      <div className="space-y-3">
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Notice to send the resident</span>
          <textarea
            value={noticeBody}
            onChange={(e) => setNoticeBody(e.target.value)}
            rows={4}
            placeholder="Describe the violation and what's needed to cure it."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Cure-by date</span>
          <input type="date" value={issueCureByDate} onChange={(e) => setIssueCureByDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          disabled={pending === "issue" || !noticeBody.trim()}
          onClick={issue}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending === "issue" ? "Issuing…" : "Issue violation notice"}
        </button>
      </div>
    );
  }

  const steps = NEXT_STEPS[status as ViolationStatusValue] ?? [];
  const availableSteps = steps.filter((s) => (s.tier === "resolve" ? canResolve : canReview || (s.value === "CURED" && canResolve)));

  if (availableSteps.length === 0) {
    return <p className="text-sm text-slate-600">No further action is available{status === "DRAFT" ? "" : " — this violation is in a terminal or unauthorized state for your role"}.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (internal, optional)</span>
        <textarea value={transitionNotes} onChange={(e) => setTransitionNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {availableSteps.some((s) => s.tier === "resolve") ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Resolution notes (board-only — required for closing actions)</span>
          <textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
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

export function ViolationCommentForm({ violationId }: { violationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hoa/violations/${violationId}/comments`, {
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
        Private (board-only — uncheck to make this visible to the resident)
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
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
