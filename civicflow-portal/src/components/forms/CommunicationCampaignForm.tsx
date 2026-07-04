"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string };

export function CommunicationCampaignForm({
  categories,
  initial,
}: {
  categories: Option[];
  initial?: Partial<{
    communicationType: string;
    selector: string;
    pushEnabled: boolean;
    deepLink: string;
    title: string;
    subject: string;
  }>;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    communicationType: initial?.communicationType ?? "GENERAL",
    channel: "EMAIL",
    subject: initial?.subject ?? "",
    body: "",
    selector: initial?.selector ?? "active_with_email",
    membershipCategoryId: "",
    city: "",
    state: "",
    zipCode: "",
    county: "",
    attachmentKeys: "",
    pushEnabled: initial?.pushEnabled ?? false,
    deepLink: initial?.deepLink ?? "",
    scheduledFor: "",
    sendNow: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const response = await fetch("/api/communications/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        communicationType: form.communicationType,
        channel: form.channel,
        subject: form.subject,
        body: form.body,
        recipientFilter: {
          selector: form.selector,
          membershipCategoryId: form.membershipCategoryId || null,
          city: form.city || null,
          state: form.state || null,
          zipCode: form.zipCode || null,
          county: form.county || null,
        },
        attachmentKeys: form.attachmentKeys.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        pushEnabled: form.pushEnabled,
        deepLink: form.deepLink || null,
        scheduledFor: form.sendNow || !form.scheduledFor ? null : new Date(form.scheduledFor).toISOString(),
        sendNow: form.sendNow,
      }),
    });
    const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: { id: string } } | null;
    setSaving(false);
    if (!response.ok || !payload?.ok || !payload.data?.id) {
      setError(payload?.error || "Failed to save campaign.");
      return;
    }
    router.push(`/communications/campaigns/${payload.data.id}`);
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Title</span><input required className={fieldClassName} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Type</span><select className={fieldClassName} value={form.communicationType} onChange={(event) => setForm((current) => ({ ...current, communicationType: event.target.value }))}><option value="GENERAL">General</option><option value="ANNOUNCEMENT">Announcement</option><option value="MEETING_MINUTES">Meeting minutes</option><option value="DUES_REMINDER">Dues reminder</option><option value="EVENT_NOTICE">Event notice</option><option value="CAMPAIGN_UPDATE">Campaign update</option><option value="OTHER">Other</option></select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Channel</span><select className={fieldClassName} value={form.channel} onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="EMAIL_AND_SMS">Email and SMS</option><option value="INTERNAL_LOG_ONLY">Internal log only</option></select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Recipients</span><select className={fieldClassName} value={form.selector} onChange={(event) => setForm((current) => ({ ...current, selector: event.target.value }))}><option value="active_with_email">All active with email</option><option value="delinquent">Delinquent members</option><option value="outstanding_dues">Members with unpaid/partial dues</option><option value="category">By category/location</option></select></label>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>Category</span><select className={fieldClassName} value={form.membershipCategoryId} onChange={(event) => setForm((current) => ({ ...current, membershipCategoryId: event.target.value }))}><option value="">Any</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>City</span><input className={fieldClassName} value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>State</span><input className={fieldClassName} value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))} /></label>
        <label className="space-y-2 text-sm font-medium text-slate-900"><span>ZIP</span><input className={fieldClassName} value={form.zipCode} onChange={(event) => setForm((current) => ({ ...current, zipCode: event.target.value }))} /></label>
      </div>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Subject</span><input required className={fieldClassName} value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} /></label>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Message body</span><textarea required rows={10} className={fieldClassName} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} /></label>
      <label className="space-y-2 text-sm font-medium text-slate-900"><span>Attachment object keys or document URLs</span><textarea rows={3} className={fieldClassName} value={form.attachmentKeys} onChange={(event) => setForm((current) => ({ ...current, attachmentKeys: event.target.value }))} /></label>

      <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
        <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
          <input type="checkbox" checked={form.pushEnabled} onChange={(event) => setForm((current) => ({ ...current, pushEnabled: event.target.checked }))} />
          Also send as mobile push notification
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Deep link (opens this screen when tapped)</span>
          <select className={fieldClassName} value={form.deepLink} onChange={(event) => setForm((current) => ({ ...current, deepLink: event.target.value }))}>
            <option value="">None</option>
            <option value="/report-payment">Report Payment</option>
            <option value="/dues">Dues Status</option>
            <option value="/announcements">Announcements</option>
            <option value="/events">Events</option>
            <option value="/payment-history">Payment History</option>
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Schedule for later (optional)</span>
          <input type="datetime-local" className={fieldClassName} value={form.scheduledFor} disabled={form.sendNow} onChange={(event) => setForm((current) => ({ ...current, scheduledFor: event.target.value }))} />
        </label>
      </div>

      <label className="flex items-center gap-3 text-sm font-medium text-slate-900"><input type="checkbox" checked={form.sendNow} onChange={(event) => setForm((current) => ({ ...current, sendNow: event.target.checked }))} />Send now</label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Saving..." : form.sendNow ? "Send Communication" : form.scheduledFor ? "Schedule Communication" : "Save Draft"}
      </button>
    </form>
  );
}
