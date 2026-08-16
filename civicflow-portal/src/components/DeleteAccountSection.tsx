"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

type Step = "collapsed" | "expanded" | "done";

/**
 * Signed-in account deletion — Profile/Settings -> Account -> Delete
 * Account. Shared between the staff-facing /settings/security page and the
 * member-facing /m/notifications page rather than duplicated, since the
 * confirmation flow and API call are identical for any authenticated user.
 *
 * Deliberately two independent confirmations (password + typed "DELETE"),
 * matching this app's existing DisableMfaForm password-gate pattern for
 * other irreversible account actions, plus an explicit typed phrase so a
 * single accidental tap/click can never trigger deletion.
 */
export function DeleteAccountSection() {
  const [step, setStep] = useState<Step>("collapsed");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedByOrganizations, setBlockedByOrganizations] = useState<{ id: string; name: string }[] | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    setBlockedByOrganizations(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmText }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "SOLE_ORG_OWNER" && Array.isArray(data.blockedByOrganizations)) {
          setBlockedByOrganizations(data.blockedByOrganizations);
        }
        setError(data.error ?? "Failed to delete account.");
        setSubmitting(false);
        return;
      }
      setStep("done");
      setTimeout(() => signOut({ callbackUrl: "/login" }), 2000);
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  }

  if (step === "done") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">✓</div>
        <p className="font-semibold text-red-900">Account deleted</p>
        <p className="mt-1 text-sm text-red-700">Signing you out…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-red-200 bg-white p-5">
      <p className="font-semibold text-red-900">Danger zone</p>
      <p className="mt-1 text-sm text-slate-600">
        Permanently delete your Unestra account — your login, profile, and personal settings. This does not delete
        any organization you belong to, or its records.
      </p>

      {step === "collapsed" ? (
        <button
          type="button"
          onClick={() => setStep("expanded")}
          className="mt-4 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Delete Account
        </button>
      ) : (
        <div className="mt-4 space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
          {blockedByOrganizations && blockedByOrganizations.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">You&apos;re the only owner of:</p>
              <ul className="mt-1 list-disc pl-5">
                {blockedByOrganizations.map((org) => (
                  <li key={org.id}>{org.name}</li>
                ))}
              </ul>
              <p className="mt-2">Transfer ownership or promote another owner before deleting your account.</p>
            </div>
          ) : null}

          {error && !blockedByOrganizations ? <p className="text-sm text-red-700">{error}</p> : null}

          <div>
            <label htmlFor="delete-account-password" className="mb-1 block text-sm font-medium text-slate-700">
              Confirm your password
            </label>
            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="delete-account-confirm-text" className="mb-1 block text-sm font-medium text-slate-700">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </label>
            <input
              id="delete-account-confirm-text"
              type="text"
              autoComplete="off"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full rounded-lg border border-red-300 px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || !password || confirmText.trim().toUpperCase() !== "DELETE"}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {submitting ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("collapsed");
                setPassword("");
                setConfirmText("");
                setError(null);
                setBlockedByOrganizations(null);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
