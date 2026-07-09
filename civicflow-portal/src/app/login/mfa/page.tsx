"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

/** True for the "challenge no longer valid" responses from /challenge and /send-sms — treated as terminal, not just an invalid-code retry. */
function isExpiredResponse(status: number, error: string | undefined) {
  return status === 401 && Boolean(error);
}

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MfaChallengePage() {
  const { data: session, status: sessionStatus } = useSession();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const markExpired = useCallback(() => {
    setExpired(true);
    setError(null);
  }, []);

  // Live countdown from the challenge's actual server-side expiry (10 min
  // TTL) — surfaces expiry proactively instead of only after a failed
  // Verify/Text-me submission, which is how this previously looked like the
  // page was just silently stuck with no way out.
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session?.mfaPending) return;

    const expiresAt = session.mfaChallengeExpiresAt;
    if (!expiresAt) {
      // mfaPending is true but there's no matching challenge row at all
      // (e.g. it was already consumed/deleted, or this is a stale session
      // cookie from a much earlier attempt) — just as terminal as a timed-out
      // one, so treat it the same rather than waiting for a failed submit.
      markExpired();
      return;
    }

    const target = new Date(expiresAt).getTime();
    const tick = () => {
      const remaining = Math.round((target - Date.now()) / 1000);
      if (remaining <= 0) {
        setSecondsLeft(0);
        markExpired();
        return;
      }
      setSecondsLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [sessionStatus, session?.mfaPending, session?.mfaChallengeExpiresAt, markExpired]);

  // Auto-restart once expired, so the user isn't left staring at a dead
  // page. Must go through signOut(), not a plain navigation — the pending
  // JWT's mfaPending flag otherwise survives the redirect and middleware
  // bounces any non-/login/mfa navigation straight back here, which is the
  // actual reason this used to look like a dead end with no way out.
  useEffect(() => {
    if (!expired) return;
    const timeout = setTimeout(() => signOut({ callbackUrl: "/login" }), 4000);
    return () => clearTimeout(timeout);
  }, [expired]);

  async function handleSendSms() {
    setSmsSending(true);
    setSmsNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/send-sms", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (isExpiredResponse(res.status, data.error)) {
          markExpired();
          return;
        }
        setError(data.error ?? "Unable to send a code by text right now.");
        return;
      }
      setSmsNotice(
        data.skipped
          ? "SMS delivery isn't configured on this server — use your authenticator app or a backup code instead."
          : `Code sent to ${data.maskedPhone}. Enter it above.`
      );
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSmsSending(false);
    }
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().replace(/\s/g, "");
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (isExpiredResponse(res.status, data.error)) {
          markExpired();
          setSubmitting(false);
          return;
        }
        setError(data.error ?? "Invalid code. Please try again.");
        setSubmitting(false);
        setCode("");
        inputRef.current?.focus();
        return;
      }

      // Exchange completion token for a full session
      const result = await signIn("mfa-complete", {
        redirect: false,
        completionToken: data.completionToken,
      });

      if (!result?.ok || result.error) {
        setError("Authentication failed. Please log in again.");
        setSubmitting(false);
        return;
      }

      router.push("/select-organization");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  }

  if (expired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-xl">⏱️</div>
          <h1 className="text-lg font-bold text-slate-900">Sign-in code expired</h1>
          <p className="mt-2 text-sm text-slate-600">
            For your security, sign-in codes expire 10 minutes after you enter your password. Please sign in again to
            get a new one.
          </p>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-5 block w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Sign in again
          </button>
          <p className="mt-3 text-xs text-slate-400">Redirecting automatically…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xl font-bold">
            🔐
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Two-factor authentication</h1>
            <p className="text-xs text-slate-500">Enter the code from your authenticator app</p>
          </div>
        </div>

        {secondsLeft !== null ? (
          <p className={`mb-4 text-center text-xs ${secondsLeft <= 60 ? "font-semibold text-amber-700" : "text-slate-400"}`}>
            Code expires in {formatCountdown(secondsLeft)}
          </p>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-slate-700">
              Authenticator code
            </label>
            <input
              ref={inputRef}
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000 000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={10}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-mono tracking-widest text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Or enter an 8-character backup code if you lost your device.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || !code.trim()}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </form>

        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={handleSendSms}
            disabled={smsSending}
            className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-60"
          >
            {smsSending ? "Sending…" : "Can't access your app? Text me a code instead"}
          </button>
        </div>
        {smsNotice ? <p className="mt-2 text-center text-xs text-slate-600">{smsNotice}</p> : null}

        <p className="mt-5 text-center text-xs text-slate-500">
          Wrong account?{" "}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="font-medium text-emerald-600 hover:underline"
          >
            Sign in with a different account
          </button>
        </p>
      </div>
    </div>
  );
}
