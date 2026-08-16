"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

/**
 * Token-gated final confirmation, reached from the emailed deletion link.
 * Receiving and clicking the emailed link already proves control of the
 * inbox, but this still requires typing "DELETE" -- the same second,
 * intentional confirmation as the signed-in flow in DeleteAccountSection --
 * since a link click alone (e.g. an email client's link-prefetch) shouldn't
 * be able to trigger deletion on its own.
 */
export function DeleteAccountConfirmForm({ token }: { token: string }) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [blockedByOrganizations, setBlockedByOrganizations] = useState<{ id: string; name: string }[] | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setBlockedByOrganizations(null);

    if (confirmText.trim().toUpperCase() !== "DELETE") {
      setError('Type "DELETE" to confirm.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/account/delete-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "SOLE_ORG_OWNER" && Array.isArray(data.blockedByOrganizations)) {
          setBlockedByOrganizations(data.blockedByOrganizations);
        }
        setError(data.error || "Deletion failed. Please request a new link.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Unable to connect. Please try again.");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 text-2xl">✓</div>
        <h1 className="text-xl font-bold text-slate-900">Account deleted</h1>
        <p className="mt-2 text-sm text-slate-600">Your account has been permanently deleted.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-slate-900">Confirm account deletion</h1>
      <p className="mt-1 text-sm text-slate-600">
        This permanently deletes your login and profile. It does not delete any organization you belong to.
      </p>

      {blockedByOrganizations && blockedByOrganizations.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">You&apos;re the only owner of:</p>
          <ul className="mt-1 list-disc pl-5">
            {blockedByOrganizations.map((org) => (
              <li key={org.id}>{org.name}</li>
            ))}
          </ul>
          <p className="mt-2">Transfer ownership or promote another owner before deleting your account.</p>
        </div>
      ) : null}

      {error && !blockedByOrganizations ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <form className="mt-6 space-y-4" method="post" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="confirmText" className="mb-1 block text-sm font-medium text-slate-700">
            Type <span className="font-mono font-bold">DELETE</span> to confirm
          </label>
          <input
            id="confirmText"
            name="confirmText"
            type="text"
            required
            autoComplete="off"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {submitting ? "Deleting..." : "Permanently delete my account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-slate-500">
        <Link href="/login" className="font-medium text-emerald-600 hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
