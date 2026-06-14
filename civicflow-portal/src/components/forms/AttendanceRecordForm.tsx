"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string; startAt?: string | null };

function toIsoDateTime(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function AttendanceRecordForm({
  members,
  events,
  defaults = {},
}: {
  members: Option[];
  events: Option[];
  defaults?: { memberId?: string; eventId?: string; meetingTitle?: string };
}) {
  const router = useRouter();
  const selectedEvent = events.find((event) => event.id === defaults.eventId);
  const [form, setForm] = useState({
    memberId: defaults.memberId ?? "",
    eventId: defaults.eventId ?? "",
    meetingTitle: defaults.meetingTitle ?? "",
    meetingDate: selectedEvent?.startAt ? selectedEvent.startAt.slice(0, 16) : new Date().toISOString().slice(0, 16),
    attendanceStatus: "PRESENT",
    checkInTime: "",
    checkOutTime: "",
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
    if (!form.memberId) nextErrors.memberId = "Member is required.";
    if (!form.eventId && !form.meetingTitle.trim()) nextErrors.meetingTitle = "Meeting title is required without an event.";
    if (!form.meetingDate) nextErrors.meetingDate = "Meeting date is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: form.memberId,
          eventId: form.eventId || null,
          meetingTitle: form.meetingTitle.trim() || null,
          meetingDate: toIsoDateTime(form.meetingDate),
          attendanceStatus: form.attendanceStatus,
          checkInTime: toIsoDateTime(form.checkInTime),
          checkOutTime: toIsoDateTime(form.checkOutTime),
          notes: form.notes.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; data?: { id: string }; details?: { fieldErrors?: Record<string, string[] | undefined> } }
        | null;
      if (!response.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          setFieldErrors(
            Object.fromEntries(
              Object.entries(apiFieldErrors).map(([field, messages]) => [field, messages?.[0] ?? "Invalid value"])
            )
          );
        }
        setError(payload?.error || "Failed to record attendance.");
        return;
      }
      router.push(payload.data?.id ? `/attendance/${payload.data.id}` : "/attendance");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Member</span>
          <select value={form.memberId} onChange={(e) => setField("memberId", e.target.value)} className={classNames(fieldClassName, fieldErrors.memberId && fieldErrorClassName)}>
            <option value="">Select a member</option>
            {members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {fieldErrors.memberId ? <p className="text-sm font-medium text-red-700">{fieldErrors.memberId}</p> : null}
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Event</span>
          <select value={form.eventId} onChange={(e) => setField("eventId", e.target.value)} className={fieldClassName}>
            <option value="">General meeting</option>
            {events.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Meeting title</span>
          <input value={form.meetingTitle} onChange={(e) => setField("meetingTitle", e.target.value)} className={classNames(fieldClassName, fieldErrors.meetingTitle && fieldErrorClassName)} />
          {fieldErrors.meetingTitle ? <p className="text-sm font-medium text-red-700">{fieldErrors.meetingTitle}</p> : null}
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Meeting date</span>
          <input type="datetime-local" value={form.meetingDate} onChange={(e) => setField("meetingDate", e.target.value)} className={classNames(fieldClassName, fieldErrors.meetingDate && fieldErrorClassName)} />
          {fieldErrors.meetingDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.meetingDate}</p> : null}
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Status</span>
          <select value={form.attendanceStatus} onChange={(e) => setField("attendanceStatus", e.target.value)} className={fieldClassName}>
            <option value="PRESENT">Present</option>
            <option value="ABSENT">Absent</option>
            <option value="EXCUSED">Excused</option>
            <option value="LATE">Late</option>
            <option value="VIRTUAL">Virtual</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Check-in</span>
          <input type="datetime-local" value={form.checkInTime} onChange={(e) => setField("checkInTime", e.target.value)} className={fieldClassName} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Check-out</span>
          <input type="datetime-local" value={form.checkOutTime} onChange={(e) => setField("checkOutTime", e.target.value)} className={fieldClassName} />
        </label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Notes</span>
        <textarea rows={4} value={form.notes} onChange={(e) => setField("notes", e.target.value)} className={fieldClassName} />
      </label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Saving..." : "Record Attendance"}
      </button>
    </form>
  );
}

