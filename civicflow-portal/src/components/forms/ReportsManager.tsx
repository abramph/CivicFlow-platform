"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fieldClassName } from "@/components/forms/formStyles";
import { ReportRecipientSelector, type ReportRecipientSelectorValue } from "@/components/forms/ReportRecipientSelector";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";

type ReportRow = {
  id: string;
  reportType: string;
  outputFormat: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  attachmentId: string | null;
};

type Option = { id: string; label: string };

const reportTypes = [
  ["GENERAL_FINANCIAL", "General financial report"],
  ["CONTRIBUTIONS", "Contributions report"],
  ["CAMPAIGNS", "Campaign report"],
  ["EVENTS", "Event report"],
  ["MONTHLY_DUES_COLLECTION", "Monthly dues collection"],
  ["DUES_PAYMENT_DETAIL", "Dues payment detail"],
  ["OUTSTANDING_DUES", "Outstanding dues"],
  ["DUES_CURRENT_MEMBERS", "Members current on dues"],
  ["FULL_YEAR_DUES_PAID", "Members with full year dues paid"],
  ["DELINQUENT_MEMBERS", "Delinquent members"],
  ["CAMPAIGN_PAYERS", "Campaign / event payer report"],
  ["EXPENDITURES", "Expenditures"],
  ["ATTENDANCE", "Attendance"],
  ["MEETING_ATTENDANCE", "Meeting attendance"],
  ["COMMUNICATIONS", "Communications"],
  ["PAYMENT_RECONCILIATION", "Payment reconciliation"],
  ["MEMBER_LOCATION", "Member demographic/location reports"],
  ["MEMBER_DEMOGRAPHICS", "Member demographics"],
] as const;

const defaultRecipient: ReportRecipientSelectorValue = {
  recipientMode: "all_active",
  categoryId: "",
  city: "",
  state: "",
  zipCode: "",
  county: "",
  eventId: "",
  meetingId: "",
  selectedMemberIds: [],
  externalEmail: "",
};

export function ReportsManager({
  rows,
  members,
  categories,
  campaigns,
  events,
  meetings,
  initial,
  canExport,
  canSend,
}: {
  rows: ReportRow[];
  members: Option[];
  categories: Option[];
  campaigns: Option[];
  events: Option[];
  meetings: Option[];
  initial: { reportType: string; startDate: string; endDate: string };
  canExport: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    reportType: initial.reportType || "GENERAL_FINANCIAL",
    startDate: initial.startDate,
    endDate: initial.endDate,
    format: "pdf",
    deliveryAction: "preview",
    memberId: "",
    categoryId: "",
    campaignId: "",
    eventId: "",
    meetingId: "",
    status: "",
    includeAttachment: true,
    includeSummary: true,
    subject: "CivicFlow report",
    body: "Attached is the requested CivicFlow report.",
  });
  const [recipient, setRecipient] = useState<ReportRecipientSelectorValue>(defaultRecipient);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterObject = useMemo(() => {
    return {
      memberId: form.memberId,
      categoryId: form.categoryId || recipient.categoryId,
      campaignId: form.campaignId,
      eventId: recipient.eventId || form.eventId,
      meetingId: recipient.meetingId || form.meetingId,
      status: form.status,
      city: recipient.city,
      state: recipient.state,
      zipCode: recipient.zipCode,
      county: recipient.county,
    };
  }, [form, recipient]);

  function buildParams(extra: Record<string, string> = {}) {
    const params = new URLSearchParams();
    params.set("reportType", form.reportType);
    if (form.startDate) params.set("startDate", form.startDate);
    if (form.endDate) params.set("endDate", form.endDate);
    for (const [key, value] of Object.entries(filterObject)) {
      if (value) params.set(key, value);
    }
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params;
  }

  function preview() {
    router.push(`/reports?${buildParams().toString()}`);
  }

  function download(format: "csv" | "xlsx" | "pdf") {
    const url = `/api/reports/export?${buildParams({ format }).toString()}`;
    if (format === "pdf") {
      // Opens in a new tab using the browser's native PDF viewer (inline
      // Content-Disposition) so the user can preview it before saving,
      // instead of forcing an immediate download.
      window.open(url, "_blank");
      return;
    }
    window.location.href = url;
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType: form.reportType,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          format: form.format,
          deliveryAction: recipient.recipientMode === "external" ? "email_external" : recipient.recipientMode === "manual" ? "email_selected" : "email_members",
          recipientMode: recipient.recipientMode,
          selectedMemberIds: recipient.selectedMemberIds,
          externalEmail: recipient.externalEmail,
          filters: filterObject,
          subject: form.subject,
          body: form.body,
          includeAttachment: form.includeAttachment,
          includeSummary: form.includeSummary,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; recipientCount?: number; sentCount?: number; skippedCount?: number; failedCount?: number }
        | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Failed to send report.");
        return;
      }
      setResult(`Recipients: ${payload.recipientCount ?? 0}; sent: ${payload.sentCount ?? 0}; skipped: ${payload.skippedCount ?? 0}; failed: ${payload.failedCount ?? 0}.`);
      router.refresh();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send report.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
          <span>Report type</span>
          <select value={form.reportType} onChange={(event) => setForm((current) => ({ ...current, reportType: event.target.value }))} className={fieldClassName}>
            {reportTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Start date</span>
          <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} className={fieldClassName} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>End date</span>
          <input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} className={fieldClassName} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Member</span>
          <select value={form.memberId} onChange={(event) => setForm((current) => ({ ...current, memberId: event.target.value }))} className={fieldClassName}>
            <option value="">Any member</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Membership category</span>
          <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))} className={fieldClassName}>
            <option value="">Any category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Campaign</span>
          <select value={form.campaignId} onChange={(event) => setForm((current) => ({ ...current, campaignId: event.target.value }))} className={fieldClassName}>
            <option value="">Any campaign</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Event</span>
          <select value={form.eventId} onChange={(event) => setForm((current) => ({ ...current, eventId: event.target.value }))} className={fieldClassName}>
            <option value="">Any event</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Meeting</span>
          <select value={form.meetingId} onChange={(event) => setForm((current) => ({ ...current, meetingId: event.target.value }))} className={fieldClassName}>
            <option value="">Any meeting</option>
            {meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.label}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Status</span>
          <input value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} className={fieldClassName} placeholder="Optional status" />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={preview} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">Preview</button>
        {canExport ? (
          <>
            <button type="button" onClick={() => download("csv")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Export CSV</button>
            <button type="button" onClick={() => download("xlsx")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Export XLSX</button>
            <button type="button" onClick={() => download("pdf")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Export PDF</button>
          </>
        ) : null}
      </div>

      {canSend ? (
        <form onSubmit={handleSend} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2 text-sm font-medium text-slate-900">
              <span>Email attachment format</span>
              <select value={form.format} onChange={(event) => setForm((current) => ({ ...current, format: event.target.value }))} className={fieldClassName}>
                <option value="pdf">PDF</option>
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-7 text-sm font-medium text-slate-900">
              <input type="checkbox" checked={form.includeAttachment} onChange={(event) => setForm((current) => ({ ...current, includeAttachment: event.target.checked }))} />
              Include attachment
            </label>
            <label className="flex items-center gap-2 pt-7 text-sm font-medium text-slate-900">
              <input type="checkbox" checked={form.includeSummary} onChange={(event) => setForm((current) => ({ ...current, includeSummary: event.target.checked }))} />
              Include summary in body
            </label>
          </div>

          <ReportRecipientSelector value={recipient} onChange={setRecipient} members={members} categories={categories} events={events} meetings={meetings} />

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Email subject</span>
            <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} className={fieldClassName} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Email message</span>
            <textarea value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} className={fieldClassName} rows={4} />
          </label>
          <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400">
            {saving ? "Sending..." : "Send Report"}
          </button>
        </form>
      ) : null}

      {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
      {result ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{result}</div> : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Format</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-600">No report exports have been queued yet.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.reportType)}</td>
                <td className="px-4 py-3 text-slate-900">{row.outputFormat.toUpperCase()}</td>
                <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.status)}</td>
                <td className="px-4 py-3 text-slate-900">{formatDateTime(row.requestedAt)}</td>
                <td className="px-4 py-3 text-slate-900">{formatDateTime(row.completedAt)}</td>
                <td className="px-4 py-3 text-slate-900">
                  {row.attachmentId ? <a href={`/api/attachments/${row.attachmentId}/download`} className="text-emerald-700 hover:underline">Download</a> : "-"}
                </td>
                <td className="px-4 py-3 text-slate-900">{row.errorMessage || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
