"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = ["ENABLED", "DISABLED", "PENDING", "SUSPENDED"] as const;
type EnrollmentStatus = (typeof STATUS_OPTIONS)[number];

/** Inline two-step confirm (not a native window.confirm dialog) for an existing enrollment row's status. */
export function LabEnrollmentStatusButton({
  organizationId,
  featureKey,
  currentStatus,
  targetStatus,
  label,
}: {
  organizationId: string;
  featureKey: string;
  currentStatus: string;
  targetStatus: EnrollmentStatus;
  label: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (currentStatus === targetStatus) return null;

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/labs/enrollments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, featureKey, status: targetStatus, confirm: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save changes.");
        setConfirming(false);
        return;
      }
      router.refresh();
      setConfirming(false);
    } catch {
      setError("Unable to connect. Please try again.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs text-slate-700">Confirm {label.toLowerCase()}?</span>
        <button
          type="button"
          disabled={pending}
          onClick={apply}
          className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Yes"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50"
      >
        {label}
      </button>
    </span>
  );
}

/** New-enrollment form: create or update an org's enrollment row for a feature. */
export function LabEnrollmentNewForm({ featureKeys }: { featureKeys: string[] }) {
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState("");
  const [featureKey, setFeatureKey] = useState(featureKeys[0] ?? "");
  const [status, setStatus] = useState<EnrollmentStatus>("ENABLED");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    if (!organizationId.trim()) {
      setError("Organization ID is required.");
      return;
    }
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/labs/enrollments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId.trim(),
          featureKey,
          status,
          notes: notes.trim() || null,
          confirm: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save changes.");
        setConfirming(false);
        return;
      }
      setSuccess(`Enrollment saved for ${data.data.organizationName}.`);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-900">Set organization enrollment</p>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Organization ID</span>
          <input
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            placeholder="cuid..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Feature</span>
          <select
            value={featureKey}
            onChange={(e) => setFeatureKey(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            {featureKeys.map((key) => (
              <option key={key} value={key}>{key}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as EnrollmentStatus)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">
          <span>Note (optional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
          />
        </label>
      </div>

      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}

      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-700">
            Confirm: set <strong>{featureKey}</strong> to <strong>{status}</strong> for organization <strong>{organizationId}</strong>?
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? "Saving..." : "Confirm"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Save Enrollment
        </button>
      )}
    </div>
  );
}
