"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AdultOption {
  id: string;
  name: string;
}

interface YearOption {
  id: string;
  label: string;
  isCurrent: boolean;
}

interface RosterPosition {
  id: string;
  name: string;
  description: string | null;
  classification: "OFFICER" | "BOARD_MEMBER";
  isVoting: boolean;
  currentAssignment: {
    id: string;
    holderName: string;
    schoolYearLabel: string | null;
    startDate: string | null;
  } | null;
}

interface HistoryEntry {
  id: string;
  personName: string | null;
  status: "INCOMING" | "ACTIVE" | "ENDED";
  schoolYearLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  householdAdult: { name: string } | null;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

/**
 * PTA Vertical 2.0, PR PTA-B — the Board page's interactive surface: assign
 * and end officers (history-preserving), prepare incoming officers, view a
 * position's complete leadership history, and manage the position list
 * itself. Officer history is append-only server-side; nothing here can
 * rewrite it.
 */
export function PtaBoardManager({
  roster,
  adults,
  years,
  canManage,
}: {
  roster: RosterPosition[];
  adults: AdultOption[];
  years: YearOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [adultId, setAdultId] = useState("");
  const [personName, setPersonName] = useState("");
  const [yearId, setYearId] = useState(years.find((year) => year.isCurrent)?.id ?? "");
  const [incoming, setIncoming] = useState(false);
  const [newPositionName, setNewPositionName] = useState("");
  const [newPositionClassification, setNewPositionClassification] = useState<"OFFICER" | "BOARD_MEMBER">("OFFICER");

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

  async function seedStandard() {
    if (await send("/api/labs/pta/board/positions/seed-standard", { method: "POST" })) {
      router.refresh();
    }
  }

  async function addPosition() {
    const ok = await send("/api/labs/pta/board/positions", {
      method: "POST",
      body: JSON.stringify({ name: newPositionName.trim(), classification: newPositionClassification }),
    });
    if (ok) {
      setNewPositionName("");
      router.refresh();
    }
  }

  async function deactivatePosition(positionId: string) {
    if (await send(`/api/labs/pta/board/positions/${positionId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })) {
      router.refresh();
    }
  }

  async function assign(positionId: string) {
    const ok = await send("/api/labs/pta/board/assignments", {
      method: "POST",
      body: JSON.stringify({
        positionId,
        householdAdultId: adultId || null,
        personName: adultId ? null : personName.trim() || null,
        schoolYearId: yearId || null,
        status: incoming ? "INCOMING" : "ACTIVE",
      }),
    });
    if (ok) {
      setAssignFor(null);
      setAdultId("");
      setPersonName("");
      setIncoming(false);
      router.refresh();
    }
  }

  async function endAssignment(assignmentId: string) {
    if (await send(`/api/labs/pta/board/assignments/${assignmentId}`, { method: "PATCH", body: JSON.stringify({ action: "end" }) })) {
      router.refresh();
    }
  }

  async function loadHistory(positionId: string) {
    if (historyFor === positionId) {
      setHistoryFor(null);
      setHistory(null);
      return;
    }
    setHistoryFor(positionId);
    setHistory(null);
    try {
      const res = await fetch(`/api/labs/pta/board/positions/${positionId}`);
      const data = await res.json().catch(() => null);
      setHistory(data?.data?.assignments ?? []);
    } catch {
      setHistory([]);
    }
  }

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const smallButton = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {roster.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm text-slate-600">No board positions yet.</p>
          {canManage ? (
            <button type="button" disabled={pending} onClick={seedStandard} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              Add the standard positions (President, Treasurer, ...)
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-3">
          {roster.map((position) => (
            <li key={position.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {position.name}
                    {position.classification === "BOARD_MEMBER" ? (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Board member</span>
                    ) : null}
                    {!position.isVoting ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Non-voting</span>
                    ) : null}
                  </p>
                  <p className="text-sm text-slate-700">
                    {position.currentAssignment ? (
                      <>
                        <span className="font-medium">{position.currentAssignment.holderName}</span>
                        {position.currentAssignment.schoolYearLabel ? ` · ${position.currentAssignment.schoolYearLabel}` : ""}
                        {position.currentAssignment.startDate ? ` · since ${formatDate(position.currentAssignment.startDate)}` : ""}
                      </>
                    ) : (
                      <span className="text-slate-500">Vacant</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => loadHistory(position.id)} className={smallButton}>
                    {historyFor === position.id ? "Hide history" : "History"}
                  </button>
                  {canManage ? (
                    <>
                      <button type="button" disabled={pending} onClick={() => setAssignFor(assignFor === position.id ? null : position.id)} className={smallButton}>
                        {position.currentAssignment ? "Replace" : "Assign"}
                      </button>
                      {position.currentAssignment ? (
                        <button type="button" disabled={pending} onClick={() => endAssignment(position.currentAssignment!.id)} className={smallButton}>
                          End term
                        </button>
                      ) : null}
                      <button type="button" disabled={pending} onClick={() => deactivatePosition(position.id)} className={smallButton}>
                        Retire position
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {assignFor === position.id && canManage ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                  <label className="space-y-1 text-xs font-medium text-slate-700">
                    <span>Parent/guardian</span>
                    <select value={adultId} onChange={(event) => setAdultId(event.target.value)} className={inputClass}>
                      <option value="">— type a name instead —</option>
                      {adults.map((adult) => (
                        <option key={adult.id} value={adult.id}>
                          {adult.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!adultId ? (
                    <label className="space-y-1 text-xs font-medium text-slate-700">
                      <span>Name</span>
                      <input value={personName} onChange={(event) => setPersonName(event.target.value)} placeholder="e.g. Jordan Smith" className={inputClass} />
                    </label>
                  ) : null}
                  <label className="space-y-1 text-xs font-medium text-slate-700">
                    <span>School year</span>
                    <select value={yearId} onChange={(event) => setYearId(event.target.value)} className={inputClass}>
                      <option value="">Unspecified</option>
                      {years.map((year) => (
                        <option key={year.id} value={year.id}>
                          {year.label}
                          {year.isCurrent ? " (current)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" checked={incoming} onChange={(event) => setIncoming(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                    <span>Incoming (takes office later)</span>
                  </label>
                  <button
                    type="button"
                    disabled={pending || (!adultId && !personName.trim())}
                    onClick={() => assign(position.id)}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              ) : null}

              {historyFor === position.id ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  {history === null ? (
                    <p className="text-sm text-slate-500">Loading history…</p>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-slate-500">No one has held this position yet.</p>
                  ) : (
                    <ul className="space-y-1 text-sm text-slate-700">
                      {history.map((entry) => (
                        <li key={entry.id}>
                          <span className="font-medium">{entry.householdAdult?.name ?? entry.personName ?? "(unnamed)"}</span>
                          {entry.schoolYearLabel ? ` · ${entry.schoolYearLabel}` : ""} · {formatDate(entry.startDate)} – {formatDate(entry.endDate)} ·{" "}
                          <span className={entry.status === "ACTIVE" ? "font-semibold text-emerald-700" : entry.status === "INCOMING" ? "font-semibold text-blue-700" : "text-slate-500"}>
                            {entry.status === "ACTIVE" ? "Current" : entry.status === "INCOMING" ? "Incoming" : "Past"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && roster.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Add a position</span>
            <input value={newPositionName} onChange={(event) => setNewPositionName(event.target.value)} placeholder="e.g. Teacher Appreciation Chair" className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Type</span>
            <select value={newPositionClassification} onChange={(event) => setNewPositionClassification(event.target.value as "OFFICER" | "BOARD_MEMBER")} className={inputClass}>
              <option value="OFFICER">Officer</option>
              <option value="BOARD_MEMBER">Board member</option>
            </select>
          </label>
          <button type="button" disabled={pending || !newPositionName.trim()} onClick={addPosition} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            Add position
          </button>
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
