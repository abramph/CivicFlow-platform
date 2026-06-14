"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function MeetingForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    meetingType: "",
    meetingDate: new Date().toISOString().slice(0, 16),
    location: "",
    description: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!form.title.trim()) nextErrors.title = "Title is required.";
    if (!form.meetingDate) nextErrors.meetingDate = "Meeting date is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          meetingType: form.meetingType.trim() || null,
          meetingDate: toIsoDateTime(form.meetingDate),
          location: form.location.trim() || null,
          description: form.description.trim() || null,
          notes: form.notes.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { id: string } } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error || "Failed to create meeting.");
        return;
      }
      router.push(payload.data?.id ? `/meetings/${payload.data.id}/attendance` : "/meetings");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Title</span><input value={form.title} onChange={(e) => setField("title", e.target.value)} className={classNames(fieldClassName, fieldErrors.title && fieldErrorClassName)} />{fieldErrors.title ? <p className="text-sm font-medium text-red-700">{fieldErrors.title}</p> : null}</label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Meeting type</span><input value={form.meetingType} onChange={(e) => setField("meetingType", e.target.value)} className={fieldClassName} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Date and time</span><input type="datetime-local" value={form.meetingDate} onChange={(e) => setField("meetingDate", e.target.value)} className={classNames(fieldClassName, fieldErrors.meetingDate && fieldErrorClassName)} />{fieldErrors.meetingDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.meetingDate}</p> : null}</label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Location</span><input value={form.location} onChange={(e) => setField("location", e.target.value)} className={fieldClassName} /></label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Description</span><textarea rows={4} value={form.description} onChange={(e) => setField("description", e.target.value)} className={fieldClassName} /></label>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Notes</span><textarea rows={4} value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={fieldClassName} /></label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">{saving ? "Creating..." : "Create Meeting"}</button>
    </form>
  );
}

