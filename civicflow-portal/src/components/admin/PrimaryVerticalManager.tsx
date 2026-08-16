"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Vertical = "COMMUNITY" | "PTA" | "UNION" | "HOA" | "CHURCH";
const VERTICAL_OPTIONS: { value: Vertical; label: string }[] = [
  { value: "COMMUNITY", label: "Community" },
  { value: "PTA", label: "PTA / PTO" },
  { value: "UNION", label: "Union" },
  { value: "HOA", label: "HOA" },
  { value: "CHURCH", label: "Church" },
];

interface Preview {
  currentVertical: Vertical;
  proposedVertical: Vertical;
  dormantOnChange: { label: string; count: number }[];
}

/**
 * Platform Admin control for changing an organization's primary vertical.
 * Two-step flow: preview the impact (read-only), then explicit confirm —
 * mirrors LabEnrollmentControls' inline confirm pattern. The change itself
 * only ever touches primaryVertical (see changeOrganizationPrimaryVertical);
 * this component never claims data will be deleted, because it never is.
 */
export function PrimaryVerticalManager({
  organizationId,
  currentVertical,
}: {
  organizationId: string;
  currentVertical: Vertical;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<Vertical>(currentVertical);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoadingPreview(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/organizations/${organizationId}/primary-vertical?to=${encodeURIComponent(target)}`
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to load the impact preview.");
        return;
      }
      setPreview(data.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function confirmChange() {
    if (!reason.trim()) {
      setError("A reason is required to correct an organization's type.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/organizations/${organizationId}/primary-vertical`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newVertical: target, reason: reason.trim(), confirm: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save this change.");
        return;
      }
      setPreview(null);
      setReason("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Correct organization type to</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as Vertical);
              setPreview(null);
            }}
            className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            {VERTICAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        {target !== currentVertical && !preview ? (
          <button
            type="button"
            disabled={loadingPreview}
            onClick={loadPreview}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {loadingPreview ? "Loading…" : "Preview Impact"}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}

      {preview ? (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Changing from <strong>{preview.currentVertical}</strong> to <strong>{preview.proposedVertical}</strong>{" "}
            will not delete any data. Only navigation and the default experience change.
          </p>
          {preview.dormantOnChange.length > 0 ? (
            <div>
              <p className="font-semibold">The following will become dormant (hidden, not deleted):</p>
              <ul className="ml-4 list-disc">
                {preview.dormantOnChange.map((d) => (
                  <li key={d.label}>{d.label}: {d.count}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.proposedVertical === "PTA" ? (
            <p>PTA/PTO is a first-class vertical — this organization will get the full PTA experience immediately, with no separate Labs enrollment step required.</p>
          ) : null}

          <label className="block space-y-1 text-xs font-medium text-amber-900">
            <span>
              Reason <span className="text-red-700">(required — recorded in the audit log)</span>
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              required
              className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200"
            />
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || !reason.trim()}
              onClick={confirmChange}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Confirm Correction"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setPreview(null);
                setTarget(currentVertical);
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
