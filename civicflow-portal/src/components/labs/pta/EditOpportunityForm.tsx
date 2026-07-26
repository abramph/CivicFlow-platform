"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 16);
}

export function EditOpportunityForm({
  opportunityId,
  initialTitle,
  initialDescription,
  initialInstructions,
  initialCancellationDeadline,
  initialSignupDeadline,
}: {
  opportunityId: string;
  initialTitle: string;
  initialDescription: string | null;
  initialInstructions: string | null;
  initialCancellationDeadline: string | null;
  initialSignupDeadline: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [instructions, setInstructions] = useState(initialInstructions ?? "");
  const [signupDeadline, setSignupDeadline] = useState(toLocalInputValue(initialSignupDeadline));
  const [cancellationDeadline, setCancellationDeadline] = useState(toLocalInputValue(initialCancellationDeadline));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteers/opportunities/${opportunityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          instructions: instructions || null,
          signupDeadline: signupDeadline ? new Date(signupDeadline).toISOString() : null,
          cancellationDeadline: cancellationDeadline ? new Date(cancellationDeadline).toISOString() : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save changes.");
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
        Edit details
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Instructions for volunteers</span>
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Signup deadline</span>
          <input value={signupDeadline} onChange={(e) => setSignupDeadline(e.target.value)} type="datetime-local" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Cancellation deadline</span>
          <input value={cancellationDeadline} onChange={(e) => setCancellationDeadline(e.target.value)} type="datetime-local" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={pending || !title.trim()} onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
          {pending ? "Saving..." : "Save changes"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}
