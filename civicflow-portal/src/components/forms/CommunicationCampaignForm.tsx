"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";

type Option = { id: string; label: string };

type WhatsAppTemplateVariable = { name: string; required: boolean; maxLength?: number };
type WhatsAppTemplateOption = { key: string; category: string; variables: WhatsAppTemplateVariable[] };

/** Only present for a PTA-vertical organization (see communications/new/page.tsx) — a Community/Union/HOA org always receives null and never sees any pta_* Recipients option. */
type PtaTargetingOptions = {
  schoolYear: string;
  grades: Option[];
  classrooms: Option[];
  committees: Option[];
  events: Option[];
};

const PTA_SELECTORS = ["pta_grade", "pta_classroom", "pta_committee", "pta_event_volunteers", "pta_unpaid"] as const;
type PtaSelector = (typeof PTA_SELECTORS)[number];

function isPtaSelector(selector: string): selector is PtaSelector {
  return (PTA_SELECTORS as readonly string[]).includes(selector);
}

/** Builds the exact PtaTargetingRule shape resolvePtaTargetMemberIds() expects (src/lib/labs/pta/communications.ts) — kept in sync manually since this is a client component and can't import a server-only lib type at runtime. */
function buildPtaRule(
  selector: PtaSelector,
  values: { gradeId: string; classroomId: string; committeeId: string; eventId: string },
  schoolYear: string
) {
  switch (selector) {
    case "pta_grade":
      return { type: "grade" as const, gradeId: values.gradeId, schoolYear };
    case "pta_classroom":
      return { type: "classroom" as const, classroomId: values.classroomId, schoolYear };
    case "pta_committee":
      return { type: "committee" as const, committeeId: values.committeeId };
    case "pta_event_volunteers":
      return { type: "volunteers_for_event" as const, eventId: values.eventId };
    case "pta_unpaid":
      return { type: "unpaid" as const, schoolYear };
  }
}

export function CommunicationCampaignForm({
  categories,
  initial,
  smsEnabled,
  emailCampaignsEnabled,
  whatsappEnabled,
  whatsappTemplates,
  ptaTargeting,
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
  smsEnabled: boolean;
  emailCampaignsEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappTemplates: WhatsAppTemplateOption[];
  ptaTargeting: PtaTargetingOptions | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    communicationType: initial?.communicationType ?? "GENERAL",
    channel: emailCampaignsEnabled ? "EMAIL" : smsEnabled ? "SMS" : "INTERNAL_LOG_ONLY",
    subject: initial?.subject ?? "",
    body: "",
    selector: initial?.selector ?? "active_with_email",
    membershipCategoryId: "",
    city: "",
    state: "",
    zipCode: "",
    county: "",
    ptaGradeId: "",
    ptaClassroomId: "",
    ptaCommitteeId: "",
    ptaEventId: "",
    attachmentKeys: "",
    pushEnabled: initial?.pushEnabled ?? false,
    deepLink: initial?.deepLink ?? "",
    scheduledFor: "",
    sendNow: false,
    whatsappEnabled: false,
    whatsappTemplateKey: "",
    whatsappTemplateVariables: {} as Record<string, string>,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const selectedTemplate = whatsappTemplates.find((template) => template.key === form.whatsappTemplateKey) ?? null;

  function buildRecipientFilter() {
    if (isPtaSelector(form.selector) && ptaTargeting) {
      return {
        selector: "pta_target",
        ptaRule: buildPtaRule(
          form.selector,
          { gradeId: form.ptaGradeId, classroomId: form.ptaClassroomId, committeeId: form.ptaCommitteeId, eventId: form.ptaEventId },
          ptaTargeting.schoolYear
        ),
      };
    }
    return {
      selector: form.selector,
      membershipCategoryId: form.membershipCategoryId || null,
      city: form.city || null,
      state: form.state || null,
      zipCode: form.zipCode || null,
      county: form.county || null,
    };
  }

  async function previewRecipients() {
    setPreviewing(true);
    setPreviewError(null);
    setPreviewCount(null);
    try {
      const response = await fetch("/api/communications/campaigns/preview-recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientFilter: buildRecipientFilter(), channel: form.channel }),
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { count: number } } | null;
      if (!response.ok || !payload?.ok) {
        setPreviewError(payload?.error || "Unable to preview recipients.");
        return;
      }
      setPreviewCount(payload.data?.count ?? 0);
    } finally {
      setPreviewing(false);
    }
  }

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
        recipientFilter: buildRecipientFilter(),
        attachmentKeys: form.attachmentKeys.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        pushEnabled: form.pushEnabled,
        deepLink: form.deepLink || null,
        scheduledFor: form.sendNow || !form.scheduledFor ? null : new Date(form.scheduledFor).toISOString(),
        sendNow: form.sendNow,
        whatsappEnabled: form.whatsappEnabled,
        whatsappTemplateKey: form.whatsappEnabled ? form.whatsappTemplateKey || undefined : undefined,
        whatsappTemplateVariables: form.whatsappEnabled ? form.whatsappTemplateVariables : undefined,
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
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Channel</span>
          <select
            className={fieldClassName}
            value={form.channel}
            aria-describedby={!emailCampaignsEnabled || !smsEnabled ? "channel-plan-hint" : undefined}
            onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))}
          >
            <option value="EMAIL" disabled={!emailCampaignsEnabled}>Email{!emailCampaignsEnabled ? " (upgrade required)" : ""}</option>
            <option value="SMS" disabled={!smsEnabled}>SMS{!smsEnabled ? " (requires add-on)" : ""}</option>
            <option value="EMAIL_AND_SMS" disabled={!emailCampaignsEnabled || !smsEnabled}>
              Email and SMS{!emailCampaignsEnabled ? " (upgrade required)" : !smsEnabled ? " (requires add-on)" : ""}
            </option>
            <option value="INTERNAL_LOG_ONLY">Internal log only</option>
          </select>
          {!emailCampaignsEnabled || !smsEnabled ? (
            <p id="channel-plan-hint" className="text-xs text-slate-500">
              {!emailCampaignsEnabled ? (
                <>Email campaigns aren&apos;t included in your current plan — <a href="/settings/billing" className="text-emerald-700 hover:underline">upgrade in Billing Settings</a>.</>
              ) : (
                <>SMS requires the SMS add-on — enable it in <a href="/settings/billing" className="text-emerald-700 hover:underline">Billing Settings</a>.</>
              )}
            </p>
          ) : null}
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Recipients</span>
          <select
            className={fieldClassName}
            value={form.selector}
            onChange={(event) => {
              const selector = event.target.value;
              setForm((current) => ({ ...current, selector }));
              setPreviewCount(null);
              setPreviewError(null);
            }}
          >
            <option value="active_with_email">All active with email</option>
            <option value="delinquent">Delinquent members</option>
            <option value="outstanding_dues">Members with unpaid/partial dues</option>
            <option value="category">By category/location</option>
            {ptaTargeting ? (
              <>
                <option value="pta_grade">By grade</option>
                <option value="pta_classroom">By classroom</option>
                <option value="pta_committee">By committee</option>
                <option value="pta_event_volunteers">Event volunteers</option>
                <option value="pta_unpaid">Households with unpaid dues</option>
              </>
            ) : null}
          </select>
        </label>
      </div>
      {ptaTargeting && form.selector === "pta_grade" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900 md:w-64">
          <span>Grade</span>
          <select className={fieldClassName} value={form.ptaGradeId} onChange={(event) => setForm((current) => ({ ...current, ptaGradeId: event.target.value }))}>
            <option value="">Select a grade…</option>
            {ptaTargeting.grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)}
          </select>
        </label>
      ) : null}
      {ptaTargeting && form.selector === "pta_classroom" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900 md:w-64">
          <span>Classroom</span>
          <select className={fieldClassName} value={form.ptaClassroomId} onChange={(event) => setForm((current) => ({ ...current, ptaClassroomId: event.target.value }))}>
            <option value="">Select a classroom…</option>
            {ptaTargeting.classrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.label}</option>)}
          </select>
        </label>
      ) : null}
      {ptaTargeting && form.selector === "pta_committee" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900 md:w-64">
          <span>Committee</span>
          <select className={fieldClassName} value={form.ptaCommitteeId} onChange={(event) => setForm((current) => ({ ...current, ptaCommitteeId: event.target.value }))}>
            <option value="">Select a committee…</option>
            {ptaTargeting.committees.map((committee) => <option key={committee.id} value={committee.id}>{committee.label}</option>)}
          </select>
        </label>
      ) : null}
      {ptaTargeting && form.selector === "pta_event_volunteers" ? (
        <label className="space-y-2 text-sm font-medium text-slate-900 md:w-64">
          <span>Event</span>
          <select className={fieldClassName} value={form.ptaEventId} onChange={(event) => setForm((current) => ({ ...current, ptaEventId: event.target.value }))}>
            <option value="">Select an event…</option>
            {ptaTargeting.events.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
          </select>
        </label>
      ) : null}
      {isPtaSelector(form.selector) ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={previewing}
            onClick={previewRecipients}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          >
            {previewing ? "Checking…" : "Preview recipient count"}
          </button>
          {previewCount !== null ? <span className="text-sm font-medium text-slate-700">{previewCount} recipient{previewCount === 1 ? "" : "s"}</span> : null}
          {previewError ? <span className="text-sm text-red-700">{previewError}</span> : null}
        </div>
      ) : null}
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

      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
          <input
            type="checkbox"
            checked={form.whatsappEnabled}
            disabled={!whatsappEnabled}
            onChange={(event) => setForm((current) => ({ ...current, whatsappEnabled: event.target.checked, whatsappTemplateKey: "", whatsappTemplateVariables: {} }))}
          />
          Also send as WhatsApp message{!whatsappEnabled ? " (requires add-on)" : ""}
        </label>
        {!whatsappEnabled ? (
          <p className="text-xs text-slate-500">
            WhatsApp requires the WhatsApp add-on — enable it in <a href="/settings/billing" className="text-emerald-700 hover:underline">Billing Settings</a>.
          </p>
        ) : null}
        {whatsappEnabled && form.whatsappEnabled ? (
          <div className="space-y-3">
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>WhatsApp template</span>
              <select
                required
                className={fieldClassName}
                value={form.whatsappTemplateKey}
                onChange={(event) => setForm((current) => ({ ...current, whatsappTemplateKey: event.target.value, whatsappTemplateVariables: {} }))}
              >
                <option value="">Select a template…</option>
                {whatsappTemplates.map((template) => (
                  <option key={template.key} value={template.key}>{template.key}</option>
                ))}
              </select>
            </label>
            {whatsappTemplates.length === 0 ? (
              <p className="text-xs text-slate-500">No approved WhatsApp templates yet — templates must be submitted to and approved by WhatsApp before they can be used.</p>
            ) : null}
            {selectedTemplate?.variables.map((variable) => (
              <label key={variable.name} className="space-y-2 text-sm font-medium text-slate-900">
                <span>{variable.name}{variable.required ? " *" : ""}</span>
                <input
                  required={variable.required}
                  maxLength={variable.maxLength}
                  className={fieldClassName}
                  value={form.whatsappTemplateVariables[variable.name] ?? ""}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      whatsappTemplateVariables: { ...current.whatsappTemplateVariables, [variable.name]: event.target.value },
                    }))
                  }
                />
              </label>
            ))}
            <p className="text-xs text-slate-500">
              WhatsApp messages won&apos;t send during your organization&apos;s configured quiet hours — they&apos;ll queue and resume automatically outside that window.
            </p>
          </div>
        ) : null}
      </div>

      <label className="flex items-center gap-3 text-sm font-medium text-slate-900"><input type="checkbox" checked={form.sendNow} onChange={(event) => setForm((current) => ({ ...current, sendNow: event.target.checked }))} />Send now</label>
      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      <button disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400">
        {saving ? "Saving..." : form.sendNow ? "Send Communication" : form.scheduledFor ? "Schedule Communication" : "Save Draft"}
      </button>
    </form>
  );
}
