"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { canSaveSlotCapacity } from "@/lib/labs/pta/volunteer-ui-rules";

/**
 * The PATCH/DELETE routes for a slot (updatePtaVolunteerSlot/
 * deletePtaVolunteerSlot in src/lib/labs/pta/volunteers.ts) have existed
 * and been tested since the slot model shipped, but had no UI entry point
 * anywhere — an officer could create a shift (ShiftForm) and assign/claim
 * volunteers into it, but never edit or remove it. This closes that gap.
 */
export function EditSlotForm({
  slotId,
  initialLabel,
  initialCapacity,
  initialMinNeeded,
  initialLocationOverride,
  claimedCount,
}: {
  slotId: string;
  initialLabel: string | null;
  initialCapacity: number;
  initialMinNeeded: number | null;
  initialLocationOverride: string | null;
  claimedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(initialLabel ?? "");
  const [capacity, setCapacity] = useState(String(initialCapacity));
  const [minNeeded, setMinNeeded] = useState(initialMinNeeded != null ? String(initialMinNeeded) : "");
  const [locationOverride, setLocationOverride] = useState(initialLocationOverride ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || null,
          capacity: Number(capacity),
          minNeeded: minNeeded ? Number(minNeeded) : null,
          locationOverride: locationOverride || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save shift.");
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50">
        Edit shift
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Label</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="9am-11am setup" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Capacity</span>
        <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min={claimedCount || 1} className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Min needed (optional)</span>
        <input value={minNeeded} onChange={(e) => setMinNeeded(e.target.value)} type="number" min={0} className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Location override (optional)</span>
        <input value={locationOverride} onChange={(e) => setLocationOverride(e.target.value)} className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {claimedCount > 0 ? <span className="text-xs text-slate-500">Capacity can&apos;t drop below {claimedCount} already assigned.</span> : null}
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      <button
        type="button"
        disabled={pending || !canSaveSlotCapacity(Number(capacity), claimedCount)}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save shift"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
        Cancel
      </button>
    </div>
  );
}
