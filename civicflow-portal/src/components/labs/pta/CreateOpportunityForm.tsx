"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/formatting";

export interface SelectableEvent {
  id: string;
  title: string;
  startAt: Date | string | null;
}

export function CreateOpportunityForm({ events = [] }: { events?: SelectableEvent[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [eventId, setEventId] = useState("");
  const [description, setDescription] = useState("");
  const [supplyRequest, setSupplyRequest] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteers/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          eventId: eventId || null,
          description: description || null,
          supplyRequest: supplyRequest || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create opportunity.");
        return;
      }
      setTitle("");
      setEventId("");
      setDescription("");
      setSupplyRequest("");
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
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
        Post a volunteer opportunity
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book Fair setup" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {events.length > 0 ? (
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Link to an event (optional)</span>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">No linked event</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}{e.startAt ? ` — ${formatDateTime(e.startAt)}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Description (optional)</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Requested supplies (optional)</span>
        <input value={supplyRequest} onChange={(e) => setSupplyRequest(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={pending || !title.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending ? "Posting..." : "Post opportunity"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}
