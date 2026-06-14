"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string };

function toIsoDateTime(value: string) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function CommunicationLogForm({
  members,
  campaigns,
  events,
  defaults = {},
}: {
  members: Option[];
  campaigns: Option[];
  events: Option[];
  defaults?: { memberId?: string; campaignId?: string; eventId?: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    memberId: defaults.memberId ?? "",
    campaignId: defaults.campaignId ?? "",
    eventId: defaults.eventId ?? "",
    communicationType: "EMAIL",
    direction: "OUTBOUND",
    subject: "",
    message: "",
    outcome: "",
    followUpRequired: false,
    followUpDate: "",
    communicationDate: new Date().toISOString().slice(0, 16),
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
    if (!form.communicationDate) nextErrors.communicationDate = "Communication date is required.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/communications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: form.memberId || null,
          campaignId: form.campaignId || null,
          eventId: form.eventId || null,
          communicationType: form.communicationType,
          direction: form.direction,
          subject: form.subject.trim() || null,
          message: form.message.trim() || null,
          outcome: form.outcome.trim() || null,
          followUpRequired: form.followUpRequired,
          followUpDate: toIsoDateTime(form.followUpDate),
          communicationDate: toIsoDateTime(form.communicationDate),
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
              Object.entries(apiFieldErrors)
                .map(([field, messages]) => [field, messages?.[0] ?? "Invalid value"])
                .filter(([, message]) => Boolean(message))
            )
          );
        }
        setError(payload?.error || "Failed to log communication.");
        return;
      }
      router.push(payload.data?.id ? `/communications/${payload.data.id}` : "/communications");
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
          <select value={form.memberId} onChange={(e) => setField("memberId", e.target.value)} className={fieldClassName}>
            <option value="">No member</option>
            {members.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Campaign</span>
          <select value={form.campaignId} onChange={(e) => setField("campaignId", e.target.value)} className={fieldClassName}>
            <option value="">No campaign</option>
            {campaigns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Event</span>
          <select value={form.eventId} onChange={(e) => setField("eventId", e.target.value)} className={fieldClassName}>
            <option value="">No event</option>
            {events.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Type</span>
          <select value={form.communicationType} onChange={(e) => setField("communicationType", e.target.value)} className={fieldClassName}>
            <option value="EMAIL">Email</option>
            <option value="SMS">SMS</option>
            <option value="PHONE_CALL">Phone call</option>
            <option value="VOICEMAIL">Voicemail</option>
            <option value="IN_PERSON">In person</option>
            <option value="LETTER">Letter</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Direction</span>
          <select value={form.direction} onChange={(e) => setField("direction", e.target.value)} className={fieldClassName}>
            <option value="OUTBOUND">Outbound</option>
            <option value="INBOUND">Inbound</option>
            <option value="INTERNAL_NOTE">Internal note</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Communication date</span>
          <input type="datetime-local" value={form.communicationDate} onChange={(e) => setField("communicationDate", e.target.value)} className={classNames(fieldClassName, fieldErrors.communicationDate && fieldErrorClassName)} />
          {fieldErrors.communicationDate ? <p className="text-sm font-medium text-red-700">{fieldErrors.communicationDate}</p> : null}
        </label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Subject</span>
        <input value={form.subject} onChange={(e) => setField("subject", e.target.value)} className={fieldClassName} />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-900">
        <span>Message</span>
        <textarea rows={5} value={form.message} onChange={(e) => setField("message", e.target.value)} className={fieldClassName} />
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Outcome</span>
          <textarea rows={3} value={form.outcome} onChange={(e) => setField("outcome", e.target.value)} className={fieldClassName} />
        </label>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={form.followUpRequired} onChange={(e) => setField("followUpRequired", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600" />
            <span>Follow-up required</span>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Follow-up date</span>
            <input type="datetime-local" value={form.followUpDate} onChange={(e) => setField("followUpDate", e.target.value)} className={fieldClassName} />
          </label>
        </div>
      </div>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Saving..." : "Log Communication"}
      </button>
    </form>
  );
}

