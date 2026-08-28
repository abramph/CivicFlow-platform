"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type NotificationType = "DEADLINE_REMINDER" | "ASSESSMENT_POSTED" | "RATE_CHANGE_UPCOMING";

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  DEADLINE_REMINDER: "Deadline reminder",
  ASSESSMENT_POSTED: "Assessment posted",
  RATE_CHANGE_UPCOMING: "Rate change upcoming",
};

interface RunResult {
  sent: number;
  skippedNoContact: number;
  failed: number;
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-L (docs/pta-volunteer-hours.md).
 * Notifications stay off by default (ptaVolunteerNotificationsEnabled). This
 * panel always offers the preview/test-send action (it bypasses that flag
 * on the server, by design — an admin must be able to test templates before
 * ever turning automated sending on) and only offers the two manual
 * "send now" triggers once notificationsAvailable is true.
 */
export function PtaVolunteerNotificationsManager({ periodId, notificationsAvailable }: { periodId: string; notificationsAvailable: boolean }) {
  const router = useRouter();
  const [previewType, setPreviewType] = useState<NotificationType>("DEADLINE_REMINDER");
  const [testRecipientEmail, setTestRecipientEmail] = useState("");
  const [pendingPreview, setPendingPreview] = useState(false);
  const [previewSent, setPreviewSent] = useState(false);
  const [triggerPending, setTriggerPending] = useState<NotificationType | null>(null);
  const [lastResult, setLastResult] = useState<{ type: NotificationType; result: RunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendPreview() {
    setPendingPreview(true);
    setPreviewSent(false);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/notifications/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationType: previewType, testRecipientEmail }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to send the test notification.");
        return;
      }
      setPreviewSent(true);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPendingPreview(false);
    }
  }

  async function triggerNow(type: "deadline-reminders" | "rate-change-notices", label: NotificationType) {
    setTriggerPending(label);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/notifications/${type}`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to send this notification batch.");
        return;
      }
      setLastResult({ type: label, result: data.data });
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setTriggerPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h4 className="text-sm font-semibold text-slate-900">Preview / test-send</h4>
        <p className="text-xs text-slate-500">
          Sends a real email to the address you enter, clearly marked [TEST]. Never sends to a real family — use this to check wording
          before turning on automated sending. Available even while notifications are off.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs font-semibold text-slate-600">
            Template
            <select
              value={previewType}
              onChange={(e) => setPreviewType(e.target.value as NotificationType)}
              className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
            >
              {(Object.keys(NOTIFICATION_TYPE_LABELS) as NotificationType[]).map((key) => (
                <option key={key} value={key}>
                  {NOTIFICATION_TYPE_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600">
            Test recipient email
            <input
              type="email"
              value={testRecipientEmail}
              onChange={(e) => setTestRecipientEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-56 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={pendingPreview || !testRecipientEmail.trim()}
            onClick={sendPreview}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {pendingPreview ? "Sending..." : "Send test"}
          </button>
        </div>
        {previewSent ? <p className="text-sm font-medium text-emerald-700">Test notification sent.</p> : null}
      </div>

      {notificationsAvailable ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <h4 className="text-sm font-semibold text-slate-900">Send now</h4>
          <p className="text-xs text-slate-500">
            Sends real notifications to real families who haven&apos;t yet been sent one for this period. Duplicate-safe — already-notified
            families are skipped automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={triggerPending !== null}
              onClick={() => triggerNow("deadline-reminders", "DEADLINE_REMINDER")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              {triggerPending === "DEADLINE_REMINDER" ? "Sending..." : "Send deadline reminders now"}
            </button>
            <button
              type="button"
              disabled={triggerPending !== null}
              onClick={() => triggerNow("rate-change-notices", "RATE_CHANGE_UPCOMING")}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              {triggerPending === "RATE_CHANGE_UPCOMING" ? "Sending..." : "Send rate-change notices now"}
            </button>
          </div>
          {lastResult ? (
            <p className="text-sm text-slate-700">
              {NOTIFICATION_TYPE_LABELS[lastResult.type]}: sent {lastResult.result.sent}, skipped (no contact email) {lastResult.result.skippedNoContact}, failed{" "}
              {lastResult.result.failed}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Turn on notifications in settings to send real deadline/rate-change notices to families.</p>
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
