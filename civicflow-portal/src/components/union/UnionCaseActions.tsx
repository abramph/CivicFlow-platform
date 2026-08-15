"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type StatusValue = "NEW" | "TRIAGE" | "ASSIGNED" | "ACTIVE" | "PENDING" | "RESOLVED" | "CLOSED" | "WITHDRAWN";

// Mirrors TRANSITIONS in src/lib/union/cases.ts, minus ASSIGNED (the only
// path to ASSIGNED is the Assign form below, which bundles the assignee
// with the status bump -- a plain transition can never set ASSIGNED with
// no assignee). Kept in sync manually since this is a client component and
// can't import server-only code; a mismatch here only affects which
// buttons are OFFERED, never what's actually allowed (the API route
// re-validates independently).
const NEXT_STEPS: Record<StatusValue, { value: StatusValue; label: string; tier: "manage" | "close" }[]> = {
  NEW: [{ value: "TRIAGE", label: "Move to triage", tier: "manage" }],
  TRIAGE: [
    { value: "CLOSED", label: "Close (no further action)", tier: "close" },
    { value: "WITHDRAWN", label: "Record withdrawal", tier: "manage" },
  ],
  ASSIGNED: [
    { value: "ACTIVE", label: "Start active work", tier: "manage" },
    { value: "TRIAGE", label: "Send back to triage", tier: "manage" },
    { value: "WITHDRAWN", label: "Record withdrawal", tier: "manage" },
  ],
  ACTIVE: [
    { value: "PENDING", label: "Mark pending (waiting on someone else)", tier: "manage" },
    { value: "RESOLVED", label: "Mark resolved", tier: "close" },
    { value: "WITHDRAWN", label: "Record withdrawal", tier: "manage" },
  ],
  PENDING: [
    { value: "ACTIVE", label: "Resume active work", tier: "manage" },
    { value: "RESOLVED", label: "Mark resolved", tier: "close" },
    { value: "WITHDRAWN", label: "Record withdrawal", tier: "manage" },
  ],
  RESOLVED: [
    { value: "CLOSED", label: "Close case", tier: "close" },
    { value: "ACTIVE", label: "Reopen", tier: "manage" },
  ],
  CLOSED: [],
  WITHDRAWN: [],
};

export function UnionCaseAssignForm({
  caseId,
  assignableMembers,
  currentAssigneeId,
}: {
  caseId: string;
  assignableMembers: { id: string; name: string }[];
  currentAssigneeId: string | null;
}) {
  const router = useRouter();
  const [assignedToOrgMemberId, setAssignedToOrgMemberId] = useState(currentAssigneeId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!assignedToOrgMemberId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToOrgMemberId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to assign this case.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>{currentAssigneeId ? "Reassign to" : "Assign to"}</span>
        <select
          value={assignedToOrgMemberId}
          onChange={(e) => setAssignedToOrgMemberId(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Select a steward or representative…</option>
          {assignableMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !assignedToOrgMemberId || assignedToOrgMemberId === currentAssigneeId}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving…" : currentAssigneeId ? "Reassign" : "Assign"}
      </button>
    </div>
  );
}

export function UnionCaseTransitionActions({ caseId, status, canManage, canClose }: { caseId: string; status: string; canManage: boolean; canClose: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [resolutionSummary, setResolutionSummary] = useState("");

  async function transition(toStatus: StatusValue) {
    setPending(toStatus);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toStatus,
          notes: notes || null,
          resolutionSummary: toStatus === "RESOLVED" ? resolutionSummary || null : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update the case.");
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
  const availableSteps = steps.filter((s) => (s.tier === "close" ? canClose : canManage));

  if (availableSteps.length === 0) {
    return <p className="text-sm text-slate-600">No further status change is available — terminal or unauthorized for your role.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Notes (internal, optional)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {availableSteps.some((s) => s.value === "RESOLVED") ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Resolution summary (member-visible — shown if resolving)</span>
          <textarea
            value={resolutionSummary}
            onChange={(e) => setResolutionSummary(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
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

export function UnionCaseCommentForm({ caseId, canNotesInternal }: { caseId: string; canNotesInternal: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  // A caller without the internal-notes permission can only ever post a
  // member-visible update -- the checkbox itself is hidden, not just
  // disabled, so there's no way to even attempt an internal note client-side
  // (the API route would reject it anyway, but this keeps the UI honest).
  const [isPrivate, setIsPrivate] = useState(canNotesInternal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, isPrivate: canNotesInternal ? isPrivate : false }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add note.");
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
        <span>Add a note</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {canNotesInternal ? (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="rounded border-slate-300" />
          Internal (union staff only — uncheck to make this visible to the member)
        </label>
      ) : (
        <p className="text-sm text-slate-600">This will be visible to the member.</p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !body.trim()}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Posting…" : "Add note"}
      </button>
    </div>
  );
}

export function UnionCaseContractReferenceForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/contract-references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, note: note || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add reference.");
        return;
      }
      setReference("");
      setNote("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. Article 5, Section 3"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !reference.trim()}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add reference"}
      </button>
    </div>
  );
}

export function UnionCaseDeadlineForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [deadlineType, setDeadlineType] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!deadlineType.trim() || !dueAt) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/deadlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineType, dueAt: new Date(dueAt).toISOString() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add deadline.");
        return;
      }
      setDeadlineType("");
      setDueAt("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={deadlineType}
          onChange={(e) => setDeadlineType(e.target.value)}
          placeholder="e.g. MANAGEMENT_RESPONSE_DUE"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !deadlineType.trim() || !dueAt}
        onClick={submit}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Add deadline"}
      </button>
    </div>
  );
}

export function UnionCaseDeadlineCompleteButton({ caseId, deadlineId }: { caseId: string; deadlineId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function complete() {
    setPending(true);
    try {
      const res = await fetch(`/api/union/cases/${caseId}/deadlines/${deadlineId}/complete`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={complete}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Mark complete"}
    </button>
  );
}
