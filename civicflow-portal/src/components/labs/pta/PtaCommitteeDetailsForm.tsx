"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface YearOption {
  id: string;
  label: string;
  isCurrent: boolean;
}

interface AdultOption {
  id: string;
  name: string;
}

/**
 * PTA Vertical 2.0, PR PTA-B — committee details editor. Two modes matching
 * the server-side authorization exactly: "manage" (officers with
 * pta:committees:manage — every field) and "chair" (this committee's own
 * chair/co-chair — description, goals, and meeting schedule only; the
 * server whitelists the same set, this UI just doesn't offer more).
 */
export function PtaCommitteeDetailsForm({
  committeeId,
  mode,
  initial,
  years,
  adults,
}: {
  committeeId: string;
  mode: "manage" | "chair";
  initial: {
    description: string | null;
    goals: string | null;
    meetingSchedule: string | null;
    status: "PLANNING" | "ACTIVE" | "COMPLETED" | "ARCHIVED";
    schoolYearId: string | null;
    boardLiaisonAdultId: string | null;
  };
  years: YearOption[];
  adults: AdultOption[];
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initial.description ?? "");
  const [goals, setGoals] = useState(initial.goals ?? "");
  const [meetingSchedule, setMeetingSchedule] = useState(initial.meetingSchedule ?? "");
  const [status, setStatus] = useState(initial.status);
  const [schoolYearId, setSchoolYearId] = useState(initial.schoolYearId ?? "");
  const [boardLiaisonAdultId, setBoardLiaisonAdultId] = useState(initial.boardLiaisonAdultId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        description: description.trim() || null,
        goals: goals.trim() || null,
        meetingSchedule: meetingSchedule.trim() || null,
      };
      if (mode === "manage") {
        body.status = status;
        body.schoolYearId = schoolYearId || null;
        body.boardLiaisonAdultId = boardLiaisonAdultId || null;
      }
      const res = await fetch(`/api/labs/pta/committees/${committeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Goals for the year</span>
        <textarea value={goals} onChange={(event) => setGoals(event.target.value)} rows={3} className={inputClass} />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Meeting schedule</span>
        <input
          value={meetingSchedule}
          onChange={(event) => setMeetingSchedule(event.target.value)}
          placeholder="e.g. First Tuesday of each month, 7pm, school library"
          className={inputClass}
        />
      </label>

      {mode === "manage" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={inputClass}>
              <option value="PLANNING">Planning</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>School year</span>
            <select value={schoolYearId} onChange={(event) => setSchoolYearId(event.target.value)} className={inputClass}>
              <option value="">Unspecified</option>
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                  {year.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Board liaison</span>
            <select value={boardLiaisonAdultId} onChange={(event) => setBoardLiaisonAdultId(event.target.value)} className={inputClass}>
              <option value="">None</option>
              {adults.map((adult) => (
                <option key={adult.id} value={adult.id}>
                  {adult.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          Save details
        </button>
        {saved ? <span className="text-sm font-medium text-emerald-700">Saved.</span> : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
