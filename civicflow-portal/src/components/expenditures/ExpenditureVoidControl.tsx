"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * feature/pta-treasurer-expenditure-experience (E2) — the void action is
 * deliberately its own small control, not a field on ExpenditureForm: it
 * sends a request carrying ONLY a voidReason (see the PATCH route), so this
 * component can never be used to bundle other field edits into a void.
 */
export function ExpenditureVoidControl({ expenditureId, canVoid, alreadyVoided }: { expenditureId: string; canVoid: boolean; alreadyVoided: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (alreadyVoided) {
    return <p className="text-sm font-medium text-slate-600">This expenditure has been voided — see audit history for who and when.</p>;
  }
  if (!canVoid) return null;

  async function submitVoid() {
    if (pending) return; // Double-submit guard: the button is also disabled while pending, this is a second layer against a fast double-click race on the client.
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/expenditures/${expenditureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voidReason: reason.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Unable to void this expenditure.");
        return;
      }
      router.refresh();
      setOpen(false);
      setReason("");
      setConfirmText("");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
        Void this expenditure
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-900">
        Voiding preserves this expenditure permanently — it is never deleted. It will be marked Voided, excluded from budget actuals and spending totals going
        forward, and remain visible with its full audit history.
      </p>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Reason (required)</span>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this expenditure is being voided"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-200"
        />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Type VOID to confirm</span>
        <input
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          className="block w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-red-600 focus:ring-2 focus:ring-red-200"
        />
      </label>
      {error ? <p role="alert" className="text-sm font-medium text-red-800">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !reason.trim() || confirmText !== "VOID"}
          onClick={submitVoid}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? "Voiding..." : "Confirm void"}
        </button>
        <button type="button" disabled={pending} onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
