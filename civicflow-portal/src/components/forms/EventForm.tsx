"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type EventFormProps = {
  mode: "create" | "edit";
  event?: {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    startAt: string;
    endAt: string;
    status: string;
    notes: string | null;
  };
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

function toIsoDateTime(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function EventForm({ mode, event }: EventFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: event?.title ?? "",
    description: event?.description ?? "",
    location: event?.location ?? "",
    startAt: event?.startAt ?? "",
    endAt: event?.endAt ?? "",
    status: event?.status ?? "upcoming",
    notes: event?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault();
    setSaving(true);
    setError(null);

    const startAt = toIsoDateTime(form.startAt);
    const endAt = toIsoDateTime(form.endAt);

    if (startAt && endAt && new Date(endAt) < new Date(startAt)) {
      setSaving(false);
      setError("End time must be on or after the start time.");
      return;
    }

    try {
      const response = await fetch(
        mode === "create" ? "/api/events" : `/api/events/${event?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: form.title.trim(),
            description: form.description.trim() || null,
            location: form.location.trim() || null,
            startAt,
            endAt,
            status: form.status.trim() || "upcoming",
            notes: form.notes.trim() || null,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { id?: string } }
        | null;

      if (!response.ok || !payload?.ok || !payload.data?.id) {
        setError(payload?.error || "Failed to save the event.");
        return;
      }

      router.push(`/events/${payload.data.id}`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save the event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Event title</span>
          <input
            required
            className={fieldClassName}
            value={form.title}
            onChange={(eventObject) => setForm((current) => ({ ...current, title: eventObject.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Location</span>
          <input
            className={fieldClassName}
            value={form.location}
            onChange={(eventObject) =>
              setForm((current) => ({ ...current, location: eventObject.target.value }))
            }
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Status</span>
          <input
            className={fieldClassName}
            value={form.status}
            onChange={(eventObject) => setForm((current) => ({ ...current, status: eventObject.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Start time</span>
          <input
            type="datetime-local"
            className={fieldClassName}
            value={form.startAt}
            onChange={(eventObject) => setForm((current) => ({ ...current, startAt: eventObject.target.value }))}
          />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>End time</span>
          <input
            type="datetime-local"
            className={fieldClassName}
            value={form.endAt}
            onChange={(eventObject) => setForm((current) => ({ ...current, endAt: eventObject.target.value }))}
          />
        </label>
      </div>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Description</span>
        <textarea
          className={fieldClassName}
          rows={5}
          value={form.description}
          onChange={(eventObject) =>
            setForm((current) => ({ ...current, description: eventObject.target.value }))
          }
        />
      </label>

      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea
          className={fieldClassName}
          rows={4}
          value={form.notes}
          onChange={(eventObject) =>
            setForm((current) => ({ ...current, notes: eventObject.target.value }))
          }
        />
      </label>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Saving..." : mode === "create" ? "Create event" : "Save event"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => router.push(event?.id ? `/events/${event.id}` : "/events")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
