"use client";

import { useEffect, useRef, useState } from "react";

interface QrData {
  qrDataUrl: string;
  checkInUrl: string;
  secondsRemainingInSlot: number | null;
  rotationSeconds: number;
}

export function AttendanceFullScreenDisplay({
  sessionId,
  meetingTitle,
  meetingDate,
  organizationName,
  mode,
  opensAt,
  closesAt,
}: {
  sessionId: string;
  meetingTitle: string;
  meetingDate: string;
  organizationName: string;
  mode: "ROTATING_QR" | "STATIC_QR";
  opensAt: string | null;
  closesAt: string | null;
}) {
  const [qr, setQr] = useState<QrData | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchQr() {
      try {
        const res = await fetch(`/api/attendance-sessions/${sessionId}/qr`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error);
          return;
        }
        setQr(data.data);
        setCountdown(data.data.secondsRemainingInSlot);
        setError(null);
      } catch {
        if (!cancelled) setError("Lost connection — retrying…");
      }
    }

    fetchQr();
    // Rotating codes need a fresh fetch each rotation window; static codes
    // just need an occasional refresh in case the session was closed/revoked.
    const refreshMs = mode === "ROTATING_QR" ? 5000 : 15000;
    const interval = setInterval(fetchQr, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, mode]);

  // Local 1s countdown ticker between fetches, purely cosmetic — the server
  // fetch above is what actually re-syncs the true remaining time. Keyed off
  // whether a countdown is active at all (not its value) so this effect
  // doesn't tear down and restart the interval every single second.
  const hasCountdown = countdown !== null;
  useEffect(() => {
    if (!hasCountdown) return;
    const tick = setInterval(() => setCountdown((s) => (s !== null && s > 0 ? s - 1 : s)), 1000);
    return () => clearInterval(tick);
  }, [hasCountdown]);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    (async () => {
      try {
        sentinel = await (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<WakeLockSentinel> } }).wakeLock.request("screen");
        wakeLockRef.current = sentinel;
      } catch {
        // Not fatal — screen may just dim on some devices/browsers that decline this.
      }
    })();
    return () => {
      sentinel?.release().catch(() => null);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-8 text-center text-white">
      <p className="text-lg font-medium text-slate-300">{organizationName}</p>
      <h1 className="text-3xl font-bold sm:text-4xl">{meetingTitle}</h1>
      <p className="text-slate-400">{new Date(meetingDate).toLocaleString()}</p>

      <div className="mt-4 rounded-2xl bg-white p-6 shadow-2xl">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr.qrDataUrl} alt="Attendance check-in QR code" className="h-72 w-72 sm:h-96 sm:w-96" />
        ) : (
          <div className="flex h-72 w-72 items-center justify-center text-slate-400 sm:h-96 sm:w-96">Loading…</div>
        )}
      </div>

      <p className="max-w-md text-lg text-slate-200">Scan with the Unestra app or your phone camera</p>

      {mode === "ROTATING_QR" && countdown !== null ? (
        <p className="text-sm text-slate-400">Code refreshes in {countdown}s</p>
      ) : mode === "STATIC_QR" ? (
        <p className="text-sm text-amber-400">Static code — less resistant to sharing than a rotating code</p>
      ) : null}

      <p className="text-sm text-slate-500">
        Check-in window: {opensAt ? new Date(opensAt).toLocaleTimeString() : "now"} – {closesAt ? new Date(closesAt).toLocaleTimeString() : "until closed"}
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}
