"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

export function DuesGenerateForm({
  memberId = "",
  members = [],
}: {
  memberId?: string;
  members?: Array<{ id: string; firstName: string; lastName: string }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ memberId, startDate: "", endDate: new Date().toISOString().slice(0, 10) });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/dues/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memberId: form.memberId || null,
        startDate: form.startDate ? `${form.startDate}T00:00:00.000Z` : null,
        endDate: form.endDate ? `${form.endDate}T23:59:59.999Z` : null,
      }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: { result?: { generatedCount?: number; skippedCount?: number; generated?: unknown[]; skipped?: unknown[] } } } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok) {
      setMessage(payload?.error || "Failed to generate dues.");
      return;
    }
    const result = payload.data?.result;
    const generated = result?.generatedCount ?? result?.generated?.length ?? 0;
    const skipped = result?.skippedCount ?? result?.skipped?.length ?? 0;
    setMessage(`Generated ${generated} charge(s); skipped ${skipped}.`);
    router.refresh();
  }

  return (
    <form className="grid gap-4 md:grid-cols-4" onSubmit={handleSubmit}>
      {!memberId ? (
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Member</span>
          <select className={fieldClassName} value={form.memberId} onChange={(event) => setForm((current) => ({ ...current, memberId: event.target.value }))}>
            <option value="">All active members</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.lastName}, {member.firstName}</option>)}
          </select>
        </label>
      ) : null}
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Start date</span>
        <input type="date" className={fieldClassName} value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>End date</span>
        <input type="date" className={fieldClassName} value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
      </label>
      <div className="flex items-end">
        <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
          {saving ? "Generating..." : "Generate Missing Dues"}
        </button>
      </div>
      {message ? <p className="flex items-end text-sm text-slate-700">{message}</p> : null}
    </form>
  );
}
