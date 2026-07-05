"use client";

import { useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function MfaChallengePage() {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [smsNotice, setSmsNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleSendSms() {
    setSmsSending(true);
    setSmsNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/send-sms", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
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

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
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
          <a href="/login" className="font-medium text-emerald-600 hover:underline">
            Sign in with a different account
          </a>
        </p>
      </div>
    </div>
  );
}
