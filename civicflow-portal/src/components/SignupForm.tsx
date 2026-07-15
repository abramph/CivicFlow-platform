"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Stage = "form" | "check-email";
type ResendState = "idle" | "sending" | "sent" | "error";

export function SignupForm() {
  const [stage, setStage] = useState<Stage>("form");
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<ResendState>("idle");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          displayName: displayName.trim() || undefined,
          orgName: orgName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Signup failed. Please try again.");
        setSubmitting(false);
        return;
      }
      setStage("check-email");
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResendState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResendState(res.ok ? "sent" : "error");
    } catch {
      setResendState("error");
    }
  };

  if (stage === "check-email") {
    return (
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl">✉</div>
        <h1 className="text-xl font-bold text-slate-900">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We sent a verification link to <span className="font-medium text-slate-800">{email}</span>.
          Click the link to activate your account.
        </p>

        <div className="mt-4 space-y-2 text-xs text-slate-400">
          <p>
            {"Didn't receive it? Check your spam folder or "}
            {resendState === "sent" ? (
              <span className="text-emerald-600 font-medium">link resent!</span>
            ) : (
              <button
                type="button"
                disabled={resendState === "sending"}
                className="underline text-emerald-600 hover:text-emerald-700 disabled:opacity-60"
                onClick={handleResend}
              >
                {resendState === "sending" ? "sending…" : "resend it"}
              </button>
            )}
            .
          </p>
          {resendState === "error" ? (
            <p className="text-red-500">Failed to resend. Please try again in a moment.</p>
          ) : null}
          <p>
            <button
              type="button"
              className="underline text-emerald-600 hover:text-emerald-700"
              onClick={() => {
                setStage("form");
                setSubmitting(false);
                setResendState("idle");
                setError(null);
                setOrgName("");
                setDisplayName("");
                setEmail("");
                setPassword("");
              }}
            >
              Use a different email
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">Get started with Unestra.</p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form className="mt-6 space-y-4" method="post" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="orgName" className="mb-1 block text-sm font-medium text-slate-700">Organization name <span className="text-red-500">*</span></label>
          <input
            id="orgName"
            name="orgName"
            type="text"
            required
            autoComplete="organization"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            placeholder="Riverside Community Coalition"
          />
        </div>

        <div>
          <label htmlFor="displayName" className="mb-1 block text-sm font-medium text-slate-700">Your name</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            placeholder="Jane Smith"
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">Email <span className="text-red-500">*</span></label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            placeholder="you@organization.org"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">Password <span className="text-red-500">*</span></label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
            placeholder="8+ characters"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-emerald-600 hover:underline">Sign in</Link>
      </p>
    </div>
  );
}
