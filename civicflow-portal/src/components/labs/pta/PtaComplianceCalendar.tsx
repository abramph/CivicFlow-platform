"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_STYLES: Record<string, string> = {
  COMPLIANT: "bg-emerald-100 text-emerald-800",
  DUE_SOON: "bg-amber-100 text-amber-800",
  OVERDUE: "bg-red-100 text-red-800",
  NOT_APPLICABLE: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS: Record<string, string> = {
  COMPLIANT: "Compliant",
  DUE_SOON: "Due soon",
  OVERDUE: "Overdue",
  NOT_APPLICABLE: "Not applicable",
};

const RECURRENCE_LABELS: Record<string, string> = {
  NONE: "One-time",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

interface RequirementView {
  id: string;
  title: string;
  ownerName: string | null;
  dueDate: string | null;
  recurrence: string;
  isApplicable: boolean;
  lastCompletedAt: string | null;
  displayStatus: string;
  notes: string | null;
}

/** PTA-I — §22 compliance calendar. Status chips are server-derived; every
 * mutation refreshes so the dashboard can never go stale. */
export function PtaComplianceCalendar({ requirements, canManage }: { requirements: RequirementView[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState("ANNUAL");

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

  async function applySuggestions() {
    if (await call("/api/labs/pta/compliance/apply-suggestions", { method: "POST" })) router.refresh();
  }

  async function addRequirement() {
    const ok = await call("/api/labs/pta/compliance", {
      method: "POST",
      body: JSON.stringify({ title: title.trim(), ownerName: ownerName.trim() || null, dueDate: dueDate || null, recurrence }),
    });
    if (ok) {
      setTitle("");
      setOwnerName("");
      setDueDate("");
      router.refresh();
    }
  }

  async function patch(requirementId: string, body: Record<string, unknown>) {
    if (await call(`/api/labs/pta/compliance/${requirementId}`, { method: "PATCH", body: JSON.stringify(body) })) router.refresh();
  }

  const counts = requirements.reduce(
    (accumulator, row) => ({ ...accumulator, [row.displayStatus]: (accumulator[row.displayStatus] ?? 0) + 1 }),
    {} as Record<string, number>
  );

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        {(["COMPLIANT", "DUE_SOON", "OVERDUE", "NOT_APPLICABLE"] as const).map((status) => (
          <span key={status} className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_STYLES[status]}`}>
            {STATUS_LABELS[status]}: {counts[status] ?? 0}
          </span>
        ))}
      </div>

      {requirements.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing tracked yet. {canManage ? "Start from the common requirements below, then tailor them to your state and council." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {requirements.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className={`text-sm font-medium ${row.isApplicable ? "text-slate-900" : "text-slate-400 line-through"}`}>{row.title}</p>
                <p className="text-xs text-slate-500">
                  {row.ownerName ? `${row.ownerName} · ` : ""}
                  {RECURRENCE_LABELS[row.recurrence] ?? row.recurrence}
                  {row.dueDate ? ` · due ${new Date(row.dueDate).toLocaleDateString()}` : " · no due date"}
                  {row.lastCompletedAt ? ` · last done ${new Date(row.lastCompletedAt).toLocaleDateString()}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.displayStatus]}`}>
                  {STATUS_LABELS[row.displayStatus] ?? row.displayStatus}
                </span>
                {canManage ? (
                  <>
                    {row.isApplicable ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => patch(row.id, { complete: true })}
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Mark complete
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => patch(row.id, { isApplicable: !row.isApplicable })}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {row.isApplicable ? "N/A" : "Reactivate"}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Requirement</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Council delegate report" className={inputClass + " w-64"} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Owner</span>
              <input value={ownerName} onChange={(event) => setOwnerName(event.target.value)} placeholder="Treasurer" className={inputClass + " w-40"} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Due</span>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={inputClass + " w-40"} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Recurs</span>
              <select value={recurrence} onChange={(event) => setRecurrence(event.target.value)} className={inputClass + " w-36"}>
                {Object.entries(RECURRENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={pending || !title.trim()}
              onClick={addRequirement}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Add requirement
            </button>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={applySuggestions}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
          >
            Add common requirements (bylaws review, insurance, audit, tax filing, …)
          </button>
          <p className="text-xs text-slate-500">
            Suggestions are just starting points — every PTA answers to its own state and council rules. Edit or mark N/A freely.
          </p>
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
