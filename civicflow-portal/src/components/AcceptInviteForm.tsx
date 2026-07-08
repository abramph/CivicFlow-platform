"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent-text";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const trimmedPhone = phone.trim();
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          password,
          ...(trimmedPhone ? { phone: trimmedPhone, smsOptIn } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to set up your account. The invite link may have expired.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl">✓</div>
        <h1 className="text-xl font-bold text-slate-900">Account ready</h1>
        <p className="mt-2 text-sm text-slate-600">Redirecting you to sign in…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">Set up your CivicFlow account</h1>
      <p className="mt-1 text-sm text-slate-600">
        Create a password to access your dues status and report payments — from this browser or the CivicFlow mobile app.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="8+ characters"
          />
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-slate-700">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="Same as above"
          />
        </div>

        <div>
          <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
            Mobile phone number <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder="+15551234567"
          />
        </div>

        {phone.trim() ? (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={smsOptIn}
                onChange={(e) => setSmsOptIn(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>{SMS_CONSENT_TEXT}</span>
            </label>
            <p className="pl-7 text-xs text-slate-500">
              <Link href="/privacy" target="_blank" className="font-medium text-emerald-700 hover:underline">
                Privacy Policy
              </Link>
              {" · "}
              <Link href="/terms" target="_blank" className="font-medium text-emerald-700 hover:underline">
                Terms of Service
              </Link>
            </p>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Setting up..." : "Create Account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        <Link href="/login" className="font-medium text-emerald-600 hover:underline">Already have an account? Sign in</Link>
      </p>
    </div>
  );
}
