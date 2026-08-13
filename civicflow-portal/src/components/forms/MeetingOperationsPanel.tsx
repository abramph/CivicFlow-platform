"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AgendaItem {
  id: string;
  title: string;
  presenterName: string | null;
  durationMinutes: number | null;
}

interface Motion {
  id: string;
  text: string;
  moverName: string | null;
  seconderName: string | null;
  status: "PROPOSED" | "SECONDED" | "PASSED" | "FAILED" | "TABLED" | "WITHDRAWN";
  decisionNumber: string | null;
  votesYes: number | null;
  votesNo: number | null;
  votesAbstain: number | null;
}

interface ActionItem {
  id: string;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH";
}

const MOTION_BADGES: Record<Motion["status"], string> = {
  PROPOSED: "bg-slate-100 text-slate-700",
  SECONDED: "bg-blue-100 text-blue-800",
  PASSED: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-red-100 text-red-800",
  TABLED: "bg-amber-100 text-amber-800",
  WITHDRAWN: "bg-slate-100 text-slate-500",
};

/**
 * PTA Vertical 2.0, PR PTA-C — the in-meeting operating surface: lifecycle
 * status, agenda, motions & votes (with Decision Register numbering on
 * pass), and action items. Core component — works for every vertical's
 * meetings; QR attendance and minutes keep their existing panels.
 */
export function MeetingOperationsPanel({
  meetingId,
  status,
  agendaItems,
  motions,
  actionItems,
  canWrite,
}: {
  meetingId: string;
  status: "DRAFT" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  agendaItems: AgendaItem[];
  motions: Motion[];
  actionItems: ActionItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agendaTitle, setAgendaTitle] = useState("");
  const [agendaPresenter, setAgendaPresenter] = useState("");
  const [motionText, setMotionText] = useState("");
  const [moverName, setMoverName] = useState("");
  const [seconderName, setSeconderName] = useState("");
  const [decidingMotion, setDecidingMotion] = useState<string | null>(null);
  const [votesYes, setVotesYes] = useState("");
  const [votesNo, setVotesNo] = useState("");
  const [votesAbstain, setVotesAbstain] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDue, setActionDue] = useState("");

  async function send(path: string, init: RequestInit): Promise<boolean> {
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

  async function setMeetingStatus(next: string) {
    if (await send(`/api/meetings/${meetingId}/status`, { method: "PATCH", body: JSON.stringify({ status: next }) })) {
      router.refresh();
    }
  }

  async function addAgenda() {
    const ok = await send(`/api/meetings/${meetingId}/agenda`, {
      method: "POST",
      body: JSON.stringify({ title: agendaTitle.trim(), presenterName: agendaPresenter.trim() || null }),
    });
    if (ok) {
      setAgendaTitle("");
      setAgendaPresenter("");
      router.refresh();
    }
  }

  async function removeAgenda(itemId: string) {
    if (await send(`/api/meetings/${meetingId}/agenda/${itemId}`, { method: "DELETE" })) {
      router.refresh();
    }
  }

  async function recordMotion() {
    const ok = await send(`/api/meetings/${meetingId}/motions`, {
      method: "POST",
      body: JSON.stringify({ text: motionText.trim(), moverName: moverName.trim() || null, seconderName: seconderName.trim() || null }),
    });
    if (ok) {
      setMotionText("");
      setMoverName("");
      setSeconderName("");
      router.refresh();
    }
  }

  async function decide(motionId: string, statusValue: "PASSED" | "FAILED" | "TABLED" | "WITHDRAWN") {
    const ok = await send(`/api/meetings/motions/${motionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: statusValue,
        votesYes: votesYes === "" ? null : Number(votesYes),
        votesNo: votesNo === "" ? null : Number(votesNo),
        votesAbstain: votesAbstain === "" ? null : Number(votesAbstain),
      }),
    });
    if (ok) {
      setDecidingMotion(null);
      setVotesYes("");
      setVotesNo("");
      setVotesAbstain("");
      router.refresh();
    }
  }

  async function addAction() {
    const ok = await send("/api/action-items", {
      method: "POST",
      body: JSON.stringify({
        meetingId,
        title: actionTitle.trim(),
        ownerName: actionOwner.trim() || null,
        dueDate: actionDue || null,
      }),
    });
    if (ok) {
      setActionTitle("");
      setActionOwner("");
      setActionDue("");
      router.refresh();
    }
  }

  async function setActionStatus(actionItemId: string, statusValue: ActionItem["status"]) {
    if (await send(`/api/action-items/${actionItemId}`, { method: "PATCH", body: JSON.stringify({ status: statusValue }) })) {
      router.refresh();
    }
  }

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const smallButton = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50";

  const nextStatuses: Record<string, { value: string; label: string }[]> = {
    DRAFT: [{ value: "SCHEDULED", label: "Mark scheduled" }, { value: "CANCELLED", label: "Cancel" }],
    SCHEDULED: [{ value: "IN_PROGRESS", label: "Start meeting" }, { value: "COMPLETED", label: "Mark completed" }, { value: "CANCELLED", label: "Cancel" }],
    IN_PROGRESS: [{ value: "COMPLETED", label: "Complete meeting" }, { value: "CANCELLED", label: "Cancel" }],
    COMPLETED: [],
    CANCELLED: [{ value: "SCHEDULED", label: "Re-schedule" }],
  };

  return (
    <div className="space-y-6">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Status: {status.replace("_", " ").toLowerCase()}</span>
          {nextStatuses[status].map((option) => (
            <button key={option.value} type="button" disabled={pending} onClick={() => setMeetingStatus(option.value)} className={smallButton}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Agenda</h3>
        {agendaItems.length === 0 ? (
          <p className="text-sm text-slate-500">No agenda items yet.</p>
        ) : (
          <ol className="mb-2 list-decimal space-y-1 pl-5 text-sm text-slate-800">
            {agendaItems.map((item) => (
              <li key={item.id}>
                {item.title}
                {item.presenterName ? <span className="text-slate-500"> — {item.presenterName}</span> : null}
                {item.durationMinutes ? <span className="text-slate-500"> ({item.durationMinutes} min)</span> : null}
                {canWrite ? (
                  <button type="button" disabled={pending} onClick={() => removeAgenda(item.id)} className="ml-2 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <input value={agendaTitle} onChange={(event) => setAgendaTitle(event.target.value)} placeholder="Agenda item" className={inputClass} />
            <input value={agendaPresenter} onChange={(event) => setAgendaPresenter(event.target.value)} placeholder="Presenter (optional)" className={inputClass} />
            <button type="button" disabled={pending || !agendaTitle.trim()} onClick={addAgenda} className={smallButton}>
              Add item
            </button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Motions &amp; decisions</h3>
        {motions.length === 0 ? (
          <p className="text-sm text-slate-500">No motions recorded.</p>
        ) : (
          <ul className="mb-2 space-y-2 text-sm">
            {motions.map((motion) => (
              <li key={motion.id} className="rounded-lg border border-slate-200 p-3">
                <p className="text-slate-900">
                  {motion.decisionNumber ? <span className="mr-2 font-semibold">Decision #{motion.decisionNumber}</span> : null}
                  {motion.text}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${MOTION_BADGES[motion.status]}`}>{motion.status.toLowerCase()}</span>
                  {motion.moverName ? `Moved by ${motion.moverName}` : ""}
                  {motion.seconderName ? `, seconded by ${motion.seconderName}` : ""}
                  {motion.votesYes !== null || motion.votesNo !== null
                    ? ` · Vote ${motion.votesYes ?? 0}–${motion.votesNo ?? 0}${motion.votesAbstain ? `–${motion.votesAbstain}` : ""}`
                    : ""}
                </p>
                {canWrite && (motion.status === "PROPOSED" || motion.status === "SECONDED" || motion.status === "TABLED") ? (
                  decidingMotion === motion.id ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <input value={votesYes} onChange={(event) => setVotesYes(event.target.value)} placeholder="Yes" inputMode="numeric" className={`${inputClass} w-16`} />
                      <input value={votesNo} onChange={(event) => setVotesNo(event.target.value)} placeholder="No" inputMode="numeric" className={`${inputClass} w-16`} />
                      <input value={votesAbstain} onChange={(event) => setVotesAbstain(event.target.value)} placeholder="Abstain" inputMode="numeric" className={`${inputClass} w-20`} />
                      <button type="button" disabled={pending} onClick={() => decide(motion.id, "PASSED")} className={smallButton}>
                        Passed
                      </button>
                      <button type="button" disabled={pending} onClick={() => decide(motion.id, "FAILED")} className={smallButton}>
                        Failed
                      </button>
                      <button type="button" disabled={pending} onClick={() => decide(motion.id, "TABLED")} className={smallButton}>
                        Tabled
                      </button>
                      <button type="button" disabled={pending} onClick={() => decide(motion.id, "WITHDRAWN")} className={smallButton}>
                        Withdrawn
                      </button>
                    </div>
                  ) : (
                    <button type="button" disabled={pending} onClick={() => setDecidingMotion(motion.id)} className={`${smallButton} mt-2`}>
                      Record vote / decide
                    </button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <input value={motionText} onChange={(event) => setMotionText(event.target.value)} placeholder="Motion text" className={`${inputClass} w-72`} />
            <input value={moverName} onChange={(event) => setMoverName(event.target.value)} placeholder="Moved by" className={inputClass} />
            <input value={seconderName} onChange={(event) => setSeconderName(event.target.value)} placeholder="Seconded by" className={inputClass} />
            <button type="button" disabled={pending || !motionText.trim()} onClick={recordMotion} className={smallButton}>
              Record motion
            </button>
          </div>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Action items</h3>
        {actionItems.length === 0 ? (
          <p className="text-sm text-slate-500">No action items from this meeting.</p>
        ) : (
          <ul className="mb-2 space-y-1 text-sm text-slate-800">
            {actionItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <span className={item.status === "COMPLETED" ? "text-slate-400 line-through" : ""}>
                  {item.title}
                  {item.ownerName ? ` — ${item.ownerName}` : ""}
                  {item.dueDate ? ` · due ${new Date(item.dueDate).toLocaleDateString()}` : ""}
                  {item.priority === "HIGH" ? " · high priority" : ""}
                </span>
                {canWrite && item.status !== "COMPLETED" && item.status !== "CANCELLED" ? (
                  <button type="button" disabled={pending} onClick={() => setActionStatus(item.id, "COMPLETED")} className={smallButton}>
                    Mark done
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <input value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} placeholder="Action item" className={`${inputClass} w-64`} />
            <input value={actionOwner} onChange={(event) => setActionOwner(event.target.value)} placeholder="Owner" className={inputClass} />
            <input type="date" value={actionDue} onChange={(event) => setActionDue(event.target.value)} className={inputClass} />
            <button type="button" disabled={pending || !actionTitle.trim()} onClick={addAction} className={smallButton}>
              Add action item
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
