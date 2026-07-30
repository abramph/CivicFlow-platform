"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  signupId: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  attendanceStatus: string | null;
}

/** One compact control cluster covering check-in, check-out, and the final attendance outcome — kept in a single component (rather than three) so an officer working an event-day queue sees one touch-friendly row per volunteer instead of hunting across separate widgets. */
export function SignupAttendanceControls({ signupId, checkInAt, checkOutAt, attendanceStatus }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minutesOverride, setMinutesOverride] = useState("");
  const [showMinutes, setShowMinutes] = useState(false);

  async function post(path: string, body?: Record<string, unknown>) {
    setPending(path);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/signups/${signupId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Action failed.");
        return;
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  function markAttendance(status: "ATTENDED" | "PARTIAL" | "NO_SHOW" | "EXCUSED") {
    const manualMinutes = showMinutes && minutesOverride ? Number(minutesOverride) : null;
    post("attendance", { status, manualMinutes });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!checkInAt ? (
        <button type="button" disabled={pending === "checkin"} onClick={() => post("checkin")} className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending === "checkin" ? "..." : "Check in"}
        </button>
      ) : !checkOutAt ? (
        <button type="button" disabled={pending === "checkout"} onClick={() => post("checkout")} className="rounded-lg bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60">
          {pending === "checkout" ? "..." : "Check out"}
        </button>
      ) : (
        <span className="text-xs text-slate-500">Checked out</span>
      )}

      {!attendanceStatus ? (
        <>
          <button type="button" disabled={Boolean(pending)} onClick={() => markAttendance("ATTENDED")} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
            Attended
          </button>
          <button type="button" disabled={Boolean(pending)} onClick={() => markAttendance("PARTIAL")} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
            Partial
          </button>
          <button type="button" disabled={Boolean(pending)} onClick={() => markAttendance("NO_SHOW")} className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
            No-show
          </button>
          <button type="button" disabled={Boolean(pending)} onClick={() => markAttendance("EXCUSED")} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
            Excused
          </button>
          <button type="button" onClick={() => setShowMinutes((s) => !s)} className="text-xs text-slate-500 underline">
            {showMinutes ? "hide minutes" : "enter exact minutes"}
          </button>
          {showMinutes ? (
            <input
              value={minutesOverride}
              onChange={(e) => setMinutesOverride(e.target.value)}
              type="number"
              min={0}
              placeholder="minutes"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
          ) : null}
        </>
      ) : (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{attendanceStatus.replace("_", " ")}</span>
      )}
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </div>
  );
}
