"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type SetupState = "idle" | "loading" | "ready" | "confirming" | "done";

interface SetupData {
  qrCodeDataUrl: string;
  backupCodes: string[];
  secret: string;
}

function MfaSetupFlow({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<SetupState>("idle");
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);

  async function startSetup() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/setup");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate setup. Please try again.");
        setState("idle");
        return;
      }
      setSetupData(data);
      setState("ready");
    } catch {
      setError("Unable to connect. Please try again.");
      setState("idle");
    }
  }

  async function confirmSetup() {
    const code = confirmCode.trim().replace(/\s/g, "");
    if (!code) return;
    setState("confirming");
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/setup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please try again.");
        setState("ready");
        return;
      }
      setState("done");
      onDone();
    } catch {
      setError("Unable to connect. Please try again.");
      setState("ready");
    }
  }

  if (state === "idle") {
    return (
      <div className="space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={startSetup}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Set up authenticator app
        </button>
      </div>
    );
  }

  if (state === "loading") {
    return <p className="text-sm text-slate-500">Generating setup…</p>;
  }

  if ((state === "ready" || state === "confirming") && setupData) {
    return (
      <div className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            1. Scan this QR code with your authenticator app
          </p>
          <img
            src={setupData.qrCodeDataUrl}
            alt="MFA QR code"
            className="rounded-lg border border-slate-200"
            width={200}
            height={200}
          />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
              Can&apos;t scan? Enter code manually
            </summary>
            <p className="mt-1 rounded bg-slate-100 px-2 py-1.5 font-mono text-xs tracking-widest text-slate-800">
              {setupData.secret}
            </p>
          </details>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            2. Save these backup codes — shown once only
          </p>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {setupData.backupCodes.map((code) => (
              <span key={code} className="font-mono text-xs text-slate-800">
                {code}
              </span>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={savedCodes}
              onChange={(e) => setSavedCodes(e.target.checked)}
              className="rounded border-slate-300"
            />
            I&apos;ve saved my backup codes in a safe place
          </label>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            3. Enter a code from your app to confirm
          </p>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000 000"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              maxLength={7}
              className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-sm tracking-widest text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={confirmSetup}
              disabled={state === "confirming" || !savedCodes || !confirmCode.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {state === "confirming" ? "Verifying…" : "Enable MFA"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function DisableMfaForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleDisable() {
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to disable MFA.");
        setSubmitting(false);
        return;
      }
      onDone();
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Disable MFA
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">Confirm your password to disable MFA</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <input
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="flex-1 rounded-lg border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none"
        />
        <button
          onClick={handleDisable}
          disabled={submitting || !password}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {submitting ? "Disabling…" : "Confirm"}
        </button>
        <button
          onClick={() => { setExpanded(false); setPassword(""); setError(null); }}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SecuritySettingsPage() {
  const router = useRouter();
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load current MFA status on mount
  useEffect(() => {
    fetch("/api/auth/mfa/status")
      .then((r) => r.json())
      .then((d) => setMfaEnabled(d.mfaEnabled ?? false))
      .catch(() => setLoadError("Failed to load security settings."));
  }, []);

  function handleMfaEnabled() {
    setMfaEnabled(true);
    router.refresh();
  }

  function handleMfaDisabled() {
    setMfaEnabled(false);
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Security</h1>
          <p className="mt-1 text-sm text-slate-600">Manage two-factor authentication for your account.</p>
        </div>
        <a href="/settings" className="text-sm text-emerald-700 hover:underline">
          ← Settings
        </a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="font-semibold text-slate-900">Two-factor authentication (TOTP)</p>
            <p className="mt-1 text-sm text-slate-600">
              Use an authenticator app like Google Authenticator or Authy to generate a one-time
              code at login.
            </p>
          </div>
          {mfaEnabled !== null && (
            <span
              className={`ml-4 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                mfaEnabled
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {mfaEnabled ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>

        {loadError && <p className="mb-4 text-sm text-red-600">{loadError}</p>}

        {mfaEnabled === null && !loadError && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}

        {mfaEnabled === false && (
          <MfaSetupFlow onDone={handleMfaEnabled} />
        )}

        {mfaEnabled === true && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="text-emerald-600">✓</span>
              <p className="text-sm text-emerald-800">
                Two-factor authentication is active. You&apos;ll be prompted for a code at each login.
              </p>
            </div>
            <DisableMfaForm onDone={handleMfaDisabled} />
          </div>
        )}
      </div>
    </main>
  );
}
