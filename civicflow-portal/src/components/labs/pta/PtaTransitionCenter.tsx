"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRANSITION_STEPS = ["PREPARING", "READY_FOR_HANDOFF", "HANDOFF_IN_PROGRESS", "ACCEPTED", "COMPLETED"] as const;

const STEP_LABELS: Record<string, string> = {
  PREPARING: "Preparing",
  READY_FOR_HANDOFF: "Ready for handoff",
  HANDOFF_IN_PROGRESS: "Handoff in progress",
  ACCEPTED: "Accepted",
  COMPLETED: "Completed",
};

const HANDOFF_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  READY: "Ready",
  ACCEPTED: "Accepted",
};

interface ChecklistItemView {
  id: string;
  title: string;
  description: string | null;
  isRequired: boolean;
  completedAt: string | null;
}

interface HandoffView {
  id: string;
  positionId: string;
  positionName: string;
  status: string;
  notes: string | null;
  acceptedAt: string | null;
  outgoingName: string | null;
  incomingAssignmentId: string | null;
  incomingName: string | null;
  checklistItems: ChecklistItemView[];
}

interface TransitionDetailView {
  id: string;
  status: string;
  notes: string | null;
  fromYear: string;
  toYear: string;
  readiness: { score: number; completed: string[]; missing: string[] };
  handoffs: HandoffView[];
}

/**
 * PTA Vertical 2.0, PR PTA-F — the Transition Center UI. All rules
 * (acceptance requirements, the COMPLETED ceremony) are enforced server-side
 * in labs/pta/transitions.ts; this component only hides controls the caller
 * cannot use and narrates the workflow.
 */
export function PtaTransitionCenter({
  canManage,
  currentYearLabel,
  nextYearLabel,
  detail,
  incomingAssignments,
  history,
}: {
  canManage: boolean;
  currentYearLabel: string | null;
  nextYearLabel: string | null;
  detail: TransitionDetailView | null;
  incomingAssignments: { id: string; positionId: string; name: string }[];
  history: { id: string; fromYear: string; toYear: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openHandoffId, setOpenHandoffId] = useState<string | null>(null);
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [newItemTitles, setNewItemTitles] = useState<Record<string, string>>({});

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function startTransition() {
    if (await call("/api/labs/pta/transitions", { method: "POST", body: JSON.stringify({}) })) {
      router.refresh();
    }
  }

  async function setTransitionStatus(status: string) {
    if (!detail) return;
    if (await call(`/api/labs/pta/transitions/${detail.id}`, { method: "PATCH", body: JSON.stringify({ status }) })) {
      router.refresh();
    }
  }

  async function saveHandoff(handoffId: string, body: Record<string, unknown>) {
    if (await call(`/api/labs/pta/handoffs/${handoffId}`, { method: "PATCH", body: JSON.stringify(body) })) {
      router.refresh();
    }
  }

  async function toggleItem(itemId: string, completed: boolean) {
    if (await call(`/api/labs/pta/checklist-items/${itemId}`, { method: "PATCH", body: JSON.stringify({ completed }) })) {
      router.refresh();
    }
  }

  async function addItem(handoffId: string) {
    const title = (newItemTitles[handoffId] ?? "").trim();
    if (!title) return;
    if (await call(`/api/labs/pta/handoffs/${handoffId}/checklist`, { method: "POST", body: JSON.stringify({ title }) })) {
      setNewItemTitles((drafts) => ({ ...drafts, [handoffId]: "" }));
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  if (!detail) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {currentYearLabel
            ? `No transition in progress. Starting one prepares the ${currentYearLabel}${nextYearLabel ? ` → ${nextYearLabel}` : ""} handoff: every active board position gets a position-specific checklist, and the sitting officer is linked as outgoing.`
            : "Set a current school year in PTA Setup before starting a board transition."}
        </p>
        {canManage && currentYearLabel ? (
          <button
            type="button"
            disabled={pending}
            onClick={startTransition}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Start board transition
          </button>
        ) : null}
        {history.length > 0 ? (
          <div className="border-t border-slate-100 pt-3">
            <h3 className="text-sm font-semibold text-slate-900">Completed transitions</h3>
            <ul className="mt-1 text-sm text-slate-600">
              {history.map((row) => (
                <li key={row.id}>
                  {row.fromYear} → {row.toYear}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const stepIndex = TRANSITION_STEPS.indexOf(detail.status as (typeof TRANSITION_STEPS)[number]);
  const allAccepted = detail.handoffs.length > 0 && detail.handoffs.every((handoff) => handoff.status === "ACCEPTED");

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        {TRANSITION_STEPS.map((step, index) => (
          <li
            key={step}
            className={`rounded-full px-3 py-1 ${
              index < stepIndex
                ? "bg-emerald-100 text-emerald-800"
                : index === stepIndex
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-100 text-slate-500"
            }`}
          >
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900">Board transition readiness — {detail.readiness.score}%</h3>
          <a
            href={`/api/labs/pta/transitions/${detail.id}/packet`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
          >
            Download transition packet (PDF)
          </a>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-600" style={{ width: `${detail.readiness.score}%` }} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Completed</p>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {detail.readiness.completed.length === 0 ? <li>Nothing yet.</li> : detail.readiness.completed.map((line) => <li key={line}>✓ {line}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Missing</p>
            <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
              {detail.readiness.missing.length === 0 ? <li>All checks pass.</li> : detail.readiness.missing.map((line) => <li key={line}>⚠ {line}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <ul className="space-y-3">
        {detail.handoffs.map((handoff) => {
          const isOpen = openHandoffId === handoff.id;
          const requiredDone = handoff.checklistItems.filter((item) => item.isRequired).every((item) => item.completedAt !== null);
          const positionIncoming = incomingAssignments.filter((assignment) => assignment.positionId === handoff.positionId);
          return (
            <li key={handoff.id} className="rounded-xl border border-slate-200">
              <button type="button" onClick={() => setOpenHandoffId(isOpen ? null : handoff.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
                <span className="text-sm font-semibold text-slate-900">{handoff.positionName}</span>
                <span className="flex items-center gap-3 text-xs">
                  <span className="text-slate-600">
                    {handoff.outgoingName ?? "— vacant —"} → {handoff.incomingName ?? "not identified"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${
                      handoff.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {HANDOFF_STATUS_LABELS[handoff.status] ?? handoff.status}
                  </span>
                </span>
              </button>
              {isOpen ? (
                <div className="space-y-4 border-t border-slate-100 px-4 py-3">
                  {canManage && detail.status !== "COMPLETED" ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="space-y-1 text-sm font-medium text-slate-900">
                        <span>Incoming officer</span>
                        <select
                          value={handoff.incomingAssignmentId ?? ""}
                          onChange={(event) => saveHandoff(handoff.id, { incomingAssignmentId: event.target.value || null })}
                          disabled={pending}
                          className={inputClass + " w-64"}
                        >
                          <option value="">— not identified —</option>
                          {positionIncoming.map((assignment) => (
                            <option key={assignment.id} value={assignment.id}>
                              {assignment.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="pb-2 text-xs text-slate-500">
                        Prepare incoming officers on the Board page (assign with status “Incoming”), then pick them here.
                      </p>
                    </div>
                  ) : null}

                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Handoff checklist</h4>
                    <ul className="mt-1 space-y-1">
                      {handoff.checklistItems.map((item) => (
                        <li key={item.id} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={item.completedAt !== null}
                            disabled={!canManage || pending || detail.status === "COMPLETED"}
                            onChange={(event) => toggleItem(item.id, event.target.checked)}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span className={item.completedAt ? "text-slate-500 line-through" : "text-slate-800"}>
                            {item.title}
                            {!item.isRequired ? <span className="ml-1 text-xs text-slate-400">(optional)</span> : null}
                            {item.description ? <span className="block text-xs font-normal text-slate-500 no-underline">{item.description}</span> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {canManage && detail.status !== "COMPLETED" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          value={newItemTitles[handoff.id] ?? ""}
                          onChange={(event) => setNewItemTitles((drafts) => ({ ...drafts, [handoff.id]: event.target.value }))}
                          placeholder="Add a checklist item for this position"
                          className={inputClass + " w-80"}
                        />
                        <button
                          type="button"
                          disabled={pending || !(newItemTitles[handoff.id] ?? "").trim()}
                          onClick={() => addItem(handoff.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Add item
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-slate-900">Handoff notes</h4>
                    <textarea
                      value={notesDrafts[handoff.id] ?? handoff.notes ?? ""}
                      onChange={(event) => setNotesDrafts((drafts) => ({ ...drafts, [handoff.id]: event.target.value }))}
                      rows={3}
                      disabled={!canManage || detail.status === "COMPLETED"}
                      placeholder="What the incoming officer needs to know."
                      className={inputClass}
                    />
                    {canManage && detail.status !== "COMPLETED" ? (
                      <button
                        type="button"
                        disabled={pending || (notesDrafts[handoff.id] ?? handoff.notes ?? "") === (handoff.notes ?? "")}
                        onClick={() => saveHandoff(handoff.id, { notes: notesDrafts[handoff.id] ?? handoff.notes ?? "" })}
                        className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Save notes
                      </button>
                    ) : null}
                  </div>

                  {canManage && detail.status !== "COMPLETED" ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      {handoff.status !== "ACCEPTED" ? (
                        <>
                          <button
                            type="button"
                            disabled={pending || !handoff.incomingAssignmentId || !requiredDone}
                            onClick={() => saveHandoff(handoff.id, { status: "ACCEPTED" })}
                            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                          >
                            Accept handoff
                          </button>
                          {!handoff.incomingAssignmentId || !requiredDone ? (
                            <p className="text-xs text-slate-500">
                              Requires an incoming officer and every required checklist item.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => saveHandoff(handoff.id, { status: "IN_PROGRESS" })}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Reopen handoff
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage && detail.status !== "COMPLETED" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {detail.status === "PREPARING" ? (
            <button type="button" disabled={pending} onClick={() => setTransitionStatus("READY_FOR_HANDOFF")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
              Mark ready for handoff
            </button>
          ) : null}
          {detail.status === "READY_FOR_HANDOFF" ? (
            <button type="button" disabled={pending} onClick={() => setTransitionStatus("HANDOFF_IN_PROGRESS")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
              Begin handoff
            </button>
          ) : null}
          {detail.status === "HANDOFF_IN_PROGRESS" ? (
            <button type="button" disabled={pending || !allAccepted} onClick={() => setTransitionStatus("ACCEPTED")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
              Mark all handoffs accepted
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending || !allAccepted}
            onClick={() => setTransitionStatus("COMPLETED")}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Complete transition — seat the new board
          </button>
          {!allAccepted ? (
            <p className="w-full text-xs text-slate-500">
              Completing requires every handoff to be accepted. It activates the incoming officers (the outgoing board is preserved as history) and makes {detail.toYear} the current school year.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
