"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SessionStatus = "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
type SessionMode = "ROTATING_QR" | "STATIC_QR";

interface AttendanceSession {
  id: string;
  status: SessionStatus;
  mode: SessionMode;
  opensAt: string | null;
  closesAt: string | null;
  lateThresholdMinutes: number;
  rotationSeconds: number;
}

interface RosterRow {
  id: string;
  memberId: string;
  attendanceStatus: "PRESENT" | "ABSENT" | "EXCUSED" | "LATE" | "VIRTUAL";
  checkInTime: string | null;
  method: string;
  correctionReason: string | null;
  member: { id: string; firstName: string; lastName: string; email: string | null };
}

interface Summary {
  status: SessionStatus;
  eligibleCount: number;
  checkedInCount: number;
  counts: Record<string, number>;
  attendancePercent: number;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  DRAFT: "Not started",
  OPEN: "Open — accepting check-ins",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  OPEN: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-slate-200 text-slate-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export type AttendanceEntity = { type: "meeting"; id: string } | { type: "event"; id: string };

export function AttendanceSessionManager({
  entity,
  canWrite,
  canReopen,
}: {
  entity: AttendanceEntity;
  canWrite: boolean;
  canReopen: boolean;
}) {
  const entityPath = entity.type === "meeting" ? "meetings" : "events";
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [correcting, setCorrecting] = useState<RosterRow | null>(null);

  const loadSession = useCallback(async () => {
    const res = await fetch(`/api/${entityPath}/${entity.id}/attendance-session`);
    const data = await res.json();
    if (data.ok) setSession(data.data);
  }, [entityPath, entity.id]);

  const loadRoster = useCallback(async () => {
    const res = await fetch(`/api/${entityPath}/${entity.id}/attendance`);
    const data = await res.json();
    if (data.ok) setRoster(data.data);
  }, [entityPath, entity.id]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadSession(), loadRoster()]);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSession, loadRoster]);

  // Poll the lightweight summary while a session is OPEN; stop entirely once
  // closed, and pause while the tab is hidden (e.g. the admin switched away
  // to the full-screen QR tab) to avoid needless load.
  useEffect(() => {
    if (!session || session.status !== "OPEN") return;
    let cancelled = false;

    async function tick() {
      if (document.hidden || !session) return;
      const res = await fetch(`/api/attendance-sessions/${session.id}/summary`);
      const data = await res.json();
      if (!cancelled && data.ok) setSummary(data.data);
      if (!cancelled) await loadRoster();
    }

    tick();
    const interval = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  async function createSession(mode: SessionMode) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${entityPath}/${entity.id}/attendance-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setSession(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the attendance session.");
    } finally {
      setBusy(false);
    }
  }

  async function callAction(path: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance-sessions/${session.id}/${path}`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setSession(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That action didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  const filteredRoster = roster.filter((row) => {
    if (statusFilter !== "ALL" && row.attendanceStatus !== statusFilter) return false;
    if (!search.trim()) return true;
    const name = `${row.member.firstName} ${row.member.lastName}`.toLowerCase();
    return name.includes(search.trim().toLowerCase()) || (row.member.email ?? "").toLowerCase().includes(search.trim().toLowerCase());
  });

  if (loading) return <p className="text-sm text-slate-600">Loading…</p>;

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {!session ? (
        canWrite ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">No attendance session yet for this meeting.</p>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() => createSession("ROTATING_QR")}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                Create Rotating QR Session (Recommended)
              </button>
              <button
                disabled={busy}
                onClick={() => createSession("STATIC_QR")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                Create Static QR Session
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Attendance hasn&apos;t been configured for this meeting yet.</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${STATUS_COLOR[session.status]}`}>
              {STATUS_LABEL[session.status]}
            </span>
            <span className="text-sm text-slate-600">
              {session.mode === "ROTATING_QR" ? `Rotating every ${session.rotationSeconds}s` : "Static code"} · Late after {session.lateThresholdMinutes} min
            </span>
          </div>

          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              {session.status === "DRAFT" ? (
                <button disabled={busy} onClick={() => callAction("open")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
                  Open Attendance
                </button>
              ) : null}
              {session.status === "OPEN" ? (
                <>
                  <Link
                    href={`/${entityPath}/${entity.id}/attendance-session/display`}
                    target="_blank"
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    Full-Screen QR
                  </Link>
                  <Link
                    href={`/${entityPath}/${entity.id}/attendance-session/print`}
                    target="_blank"
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    Print QR Sheet
                  </Link>
                  <button disabled={busy} onClick={() => callAction("regenerate")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
                    Regenerate Code
                  </button>
                  <button disabled={busy} onClick={() => callAction("close")} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
                    Close Attendance
                  </button>
                </>
              ) : null}
              {session.status === "CLOSED" && canReopen ? (
                <button disabled={busy} onClick={() => callAction("reopen")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
                  Reopen Attendance
                </button>
              ) : null}
              <Link
                href={`/api/${entityPath}/${entity.id}/attendance/export`}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Export CSV
              </Link>
            </div>
          ) : null}

          {summary ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <SummaryStat label="Eligible" value={summary.eligibleCount} />
              <SummaryStat label="Present" value={summary.counts.PRESENT ?? 0} />
              <SummaryStat label="Late" value={summary.counts.LATE ?? 0} />
              <SummaryStat label="Excused" value={summary.counts.EXCUSED ?? 0} />
              <SummaryStat label="Attendance %" value={`${summary.attendancePercent}%`} />
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search members…"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="ALL">All statuses</option>
                <option value="PRESENT">Present</option>
                <option value="LATE">Late</option>
                <option value="EXCUSED">Excused</option>
                <option value="ABSENT">Absent</option>
                <option value="VIRTUAL">Virtual</option>
              </select>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Member</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Checked In</th>
                    <th className="px-3 py-2">Method</th>
                    {canWrite ? <th className="px-3 py-2">Actions</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRoster.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2">{row.member.firstName} {row.member.lastName}</td>
                      <td className="px-3 py-2">{row.attendanceStatus}</td>
                      <td className="px-3 py-2">{row.checkInTime ? new Date(row.checkInTime).toLocaleTimeString() : "—"}</td>
                      <td className="px-3 py-2">{row.method}</td>
                      {canWrite ? (
                        <td className="px-3 py-2">
                          <button onClick={() => setCorrecting(row)} className="text-emerald-700 hover:underline">Correct</button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                  {filteredRoster.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No matching attendance records yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <Link href={`/${entityPath}/${entity.id}/attendance-session/audit`} className="text-sm font-medium text-emerald-700 hover:underline">
            View attendance audit history
          </Link>
        </>
      )}

      {correcting ? (
        <CorrectionModal
          row={correcting}
          onClose={() => setCorrecting(null)}
          onSaved={() => {
            setCorrecting(null);
            loadRoster();
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function CorrectionModal({ row, onClose, onSaved }: { row: RosterRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(row.attendanceStatus);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasonNeeded = status !== row.attendanceStatus || status === "EXCUSED";

  async function save() {
    if (reasonNeeded && !reason.trim()) {
      setError("A reason is required when correcting attendance or marking it excused.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceStatus: status, correctionReason: reason || undefined }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this correction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-950">Correct attendance — {row.member.firstName} {row.member.lastName}</h3>
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
        <label className="mt-4 block text-sm font-medium text-slate-700">Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value as RosterRow["attendanceStatus"])} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="PRESENT">Present</option>
          <option value="LATE">Late</option>
          <option value="EXCUSED">Excused</option>
          <option value="ABSENT">Absent</option>
          <option value="VIRTUAL">Virtual</option>
        </select>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Reason {reasonNeeded ? <span className="text-red-600">(required)</span> : "(optional)"}
        </label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Cancel</button>
          <button disabled={saving} onClick={save} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
            {saving ? "Saving…" : "Save Correction"}
          </button>
        </div>
      </div>
    </div>
  );
}
