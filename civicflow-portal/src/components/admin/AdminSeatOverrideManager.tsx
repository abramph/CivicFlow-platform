"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  organizationId: string;
  currentOverride: number;
  overrideActive: boolean;
}

/**
 * Platform Admin control for granting, changing, or removing an
 * organization's administrative-seat override. Deliberately never rendered
 * on any org-facing page — org admins cannot edit their own org's override,
 * by construction (no org-scoped route exists for this).
 */
export function AdminSeatOverrideManager({ organizationId, currentOverride, overrideActive }: Props) {
  const router = useRouter();
  const [newOverride, setNewOverride] = useState(String(currentOverride));
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitOverride() {
    setError(null);
    const parsed = Number(newOverride);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Override must be a whole number, 0 or greater.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/admin-seats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newOverride: parsed,
          reason: reason.trim(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save this override.");
        return;
      }
      setReason("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride() {
    setError(null);
    if (!reason.trim()) {
      setError("A reason is required to remove the override.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/admin-seats`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to remove this override.");
        return;
      }
      setReason("");
      setNewOverride("0");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Additional seats (override)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={newOverride}
            onChange={(e) => setNewOverride(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Expires (optional)</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <div className="text-xs text-slate-500 sm:pt-5">
          {overrideActive ? `Currently active: +${currentOverride} seats` : "No active override"}
        </div>
      </div>

      <label className="block space-y-1 text-xs font-medium text-slate-700">
        <span>
          Reason <span className="text-red-700">(required — recorded in the audit log)</span>
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        />
      </label>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saving || !reason.trim()}
          onClick={submitOverride}
          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Override"}
        </button>
        {overrideActive ? (
          <button
            type="button"
            disabled={saving || !reason.trim()}
            onClick={removeOverride}
            className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Remove Override
          </button>
        ) : null}
      </div>
    </div>
  );
}
