"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

export function ContributionVoidForm({ contributionId }: { contributionId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVoid() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/contributions/${contributionId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !payload?.ok) {
        setError(payload?.error ?? "Failed to void contribution.");
        setSaving(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
        >
          Void this contribution
        </button>
        <p className="text-sm text-slate-600">
          Voiding marks the record as cancelled. The original entry is preserved for audit purposes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-red-700">
        Are you sure you want to void this contribution? This cannot be undone.
      </p>
      <label className="block space-y-1.5 text-sm font-medium text-slate-900">
        <span>Reason (optional)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={fieldClassName}
          placeholder="Data entry error, duplicate record, etc."
          maxLength={500}
        />
      </label>
      {error ? (
        <p className="text-sm font-medium text-red-700">{error}</p>
      ) : null}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleVoid}
          disabled={saving}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Voiding…" : "Confirm void"}
        </button>
        <button
          type="button"
          onClick={() => { setConfirming(false); setError(null); }}
          disabled={saving}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
