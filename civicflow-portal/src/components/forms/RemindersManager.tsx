"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { classNames, fieldClassName, fieldErrorClassName, helperTextClassName } from "@/components/forms/formStyles";
import { formatDateTime, formatEnumLabel } from "@/lib/formatting";

type MemberOption = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
};

type ReminderRow = {
  id: string;
  reminderType: string;
  status: string;
  recipientEmail: string | null;
  subject: string | null;
  createdAt: string;
  sentAt: string | null;
  memberName: string | null;
};

export function RemindersManager({
  members,
  rows,
}: {
  members: MemberOption[];
  rows: ReminderRow[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    memberId: "",
    reminderType: "DUES_DELINQUENT",
    recipientEmail: "",
    subject: "",
    bodyPreview: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selectedMember = useMemo(
    () => members.find((member) => member.id === form.memberId) ?? null,
    [form.memberId, members]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          memberId: form.memberId || null,
          reminderType: form.reminderType,
          recipientEmail: form.recipientEmail.trim() || selectedMember?.email || null,
          subject: form.subject.trim() || null,
          bodyPreview: form.bodyPreview.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; details?: { fieldErrors?: Record<string, string[] | undefined> } }
        | null;

      if (!response.ok || !payload?.ok) {
        const apiFieldErrors = payload?.details?.fieldErrors;
        if (apiFieldErrors) {
          const nextFieldErrors: Record<string, string> = {};
          for (const [field, messages] of Object.entries(apiFieldErrors)) {
            const firstMessage = messages?.[0];
            if (firstMessage) nextFieldErrors[field] = firstMessage;
          }
          setFieldErrors(nextFieldErrors);
        }
        setError(payload?.error || "Failed to queue the reminder.");
        return;
      }

      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Failed to queue the reminder."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Member</span>
            <select
              value={form.memberId}
              onChange={(event) => setForm((current) => ({ ...current, memberId: event.target.value }))}
              className={classNames(fieldClassName, fieldErrors.memberId && fieldErrorClassName)}
            >
              <option value="">No member selected</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.lastName}, {member.firstName}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900">
            <span>Reminder type</span>
            <select
              value={form.reminderType}
              onChange={(event) => setForm((current) => ({ ...current, reminderType: event.target.value }))}
              className={classNames(fieldClassName, fieldErrors.reminderType && fieldErrorClassName)}
            >
              <option value="DUES_DELINQUENT">Dues delinquent</option>
              <option value="DUES_UPCOMING">Dues upcoming</option>
              <option value="CONTRIBUTION_RECEIPT">Contribution receipt</option>
              <option value="MEMBERSHIP_RENEWAL">Membership renewal</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-900 md:col-span-2">
            <span>Recipient email</span>
            <input
              value={form.recipientEmail}
              onChange={(event) => setForm((current) => ({ ...current, recipientEmail: event.target.value }))}
              className={classNames(fieldClassName, fieldErrors.recipientEmail && fieldErrorClassName)}
            />
            {fieldErrors.recipientEmail ? <p className="text-sm font-medium text-red-700">{fieldErrors.recipientEmail}</p> : null}
            <p className={helperTextClassName}>Leave blank to use the selected member’s email address when available.</p>
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Subject</span>
          <input
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            className={classNames(fieldClassName, fieldErrors.subject && fieldErrorClassName)}
          />
          {fieldErrors.subject ? <p className="text-sm font-medium text-red-700">{fieldErrors.subject}</p> : null}
        </label>

        <label className="space-y-2 text-sm font-medium text-slate-900">
          <span>Body preview</span>
          <textarea
            rows={5}
            value={form.bodyPreview}
            onChange={(event) => setForm((current) => ({ ...current, bodyPreview: event.target.value }))}
            className={classNames(fieldClassName, fieldErrors.bodyPreview && fieldErrorClassName)}
          />
          {fieldErrors.bodyPreview ? <p className="text-sm font-medium text-red-700">{fieldErrors.bodyPreview}</p> : null}
        </label>

        {error ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {saving ? "Queueing..." : "Queue Reminder"}
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-700">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Recipient</th>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Sent</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-600">
                  No reminders have been queued yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-900">
                    <p>{formatEnumLabel(row.reminderType)}</p>
                    {row.subject ? <p className={`mt-1 ${helperTextClassName}`}>{row.subject}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-900">{formatEnumLabel(row.status)}</td>
                  <td className="px-4 py-3 text-slate-900">{row.recipientEmail ?? "No recipient"}</td>
                  <td className="px-4 py-3 text-slate-900">{row.memberName ?? "No member"}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3 text-slate-900">{formatDateTime(row.sentAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
