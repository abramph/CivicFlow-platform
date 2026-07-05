"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

export function ManualTimelineEventForm({ memberId, canWrite }: { memberId: string; canWrite: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", description: "", occurredAt: new Date().toISOString().slice(0, 16) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWrite) {
    return <p className="text-sm text-slate-700">You have read-only access to this member&apos;s timeline.</p>;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/members/${memberId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to add timeline note.");
        return;
      }
      setForm({ title: "", description: "", occurredAt: new Date().toISOString().slice(0, 16) });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-3">
        <input placeholder="Timeline note title" value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} className={fieldClassName} />
        <input type="datetime-local" value={form.occurredAt} onChange={(e) => setForm((current) => ({ ...current, occurredAt: e.target.value }))} className={fieldClassName} />
        <button type="submit" disabled={saving || !form.title.trim()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">{saving ? "Adding..." : "Add Timeline Note"}</button>
      </div>
      <textarea rows={3} placeholder="Description" value={form.description} onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))} className={fieldClassName} />
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
    </form>
  );
}

