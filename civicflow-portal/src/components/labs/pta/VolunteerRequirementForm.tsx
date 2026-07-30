"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function VolunteerRequirementForm({
  schoolYear,
  initialRequiredHours,
  initialActive,
}: {
  schoolYear: string;
  initialRequiredHours: number | null;
  initialActive: boolean;
}) {
  const router = useRouter();
  const [hours, setHours] = useState(initialRequiredHours != null ? String(initialRequiredHours) : "");
  const [active, setActive] = useState(initialActive);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/labs/pta/volunteers/requirement", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolYear, requiredMinutes: Math.round(Number(hours || 0) * 60), active }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Required hours per household ({schoolYear})</span>
        <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min={0} step="0.5" placeholder="e.g. 10" className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Enforce this requirement
      </label>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      {success ? <span className="text-sm text-emerald-700">Saved.</span> : null}
      <button type="button" disabled={pending} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Saving..." : "Save"}
      </button>
      <p className="w-full text-xs text-slate-500">Leave hours at 0 and uncheck &quot;enforce&quot; if this PTA doesn&apos;t track a required amount — the feature works fully either way.</p>
    </div>
  );
}
