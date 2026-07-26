"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddSlotForm({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/opportunities/${opportunityId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || null, capacity: Number(capacity) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add slot.");
        return;
      }
      setLabel("");
      setCapacity("1");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50">
        Add time slot
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Label (optional)</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="9am–11am" className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="space-y-1 text-sm font-medium text-slate-900">
        <span>Capacity</span>
        <input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min={1} className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {error ? <span className="text-sm text-red-700">{error}</span> : null}
      <button type="button" disabled={pending || Number(capacity) < 1} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Adding..." : "Add slot"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
        Cancel
      </button>
    </div>
  );
}
