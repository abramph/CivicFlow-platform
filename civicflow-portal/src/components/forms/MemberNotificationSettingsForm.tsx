"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";
import { isValidE164Phone } from "@/lib/phone";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent-text";

type View = "status" | "verify" | "code";

export function MemberNotificationSettingsForm({
  organizationId,
  phone,
  smsOptIn,
  smsOptInDate,
  smsOptInMethodLabel,
  smsOptOutDate,
  commsSmsEnabled,
  hardStopBlocked,
  consentMethod = "PROFILE_SETTINGS",
  onOptedIn,
}: {
  organizationId: string;
  phone: string | null;
  smsOptIn: boolean;
  smsOptInDate: string | null;
  smsOptInMethodLabel: string | null;
  smsOptOutDate: string | null;
  commsSmsEnabled: boolean;
  hardStopBlocked: boolean;
  /** "QR_CODE" when this form is embedded on the public /sms-opt-in landing page instead of Notification Settings. */
  consentMethod?: "PROFILE_SETTINGS" | "QR_CODE";
  /** Called after a successful opt-in confirmation, in addition to the default router.refresh(). */
  onOptedIn?: () => void;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>(smsOptIn ? "status" : "verify");
  const [phoneInput, setPhoneInput] = useState(phone ?? "");
  const [consentChecked, setConsentChecked] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!isValidE164Phone(phoneInput.trim())) {
      setError("Enter a valid phone number in international format, e.g. +15551234567.");
      return;
    }
    if (!consentChecked) {
      setError("You must check the consent box to receive SMS notifications.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/member-portal/notifications/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, phone: phoneInput.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to send a verification code.");
        return;
      }
      setNotice(`We sent a 6-digit code to ${phoneInput.trim()}.`);
      setView("code");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/member-portal/notifications/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, code: code.trim(), method: consentMethod }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Invalid or expired code.");
        return;
      }
      setNotice(null);
      setCode("");
      setView("status");
      router.refresh();
      onOptedIn?.();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle() {
    setError(null);
    setTogglePending(true);
    try {
      const res = await fetch("/api/member-portal/notifications/toggle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, enabled: !commsSmsEnabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to update your preference.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setTogglePending(false);
    }
  }

  async function handleWithdraw() {
    if (!window.confirm("Withdraw SMS consent? You'll need to re-verify your phone number to receive texts again.")) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/member-portal/notifications/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to withdraw consent.");
        return;
      }
      router.refresh();
      setView("verify");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "status" && smsOptIn) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">SMS consent on file</p>
          <p className="mt-1 text-sm text-emerald-800">
            Opted in {smsOptInDate ? new Date(smsOptInDate).toLocaleString() : ""}
            {smsOptInMethodLabel ? ` via ${smsOptInMethodLabel}` : ""}.
          </p>
          <p className="mt-1 text-sm text-emerald-800">Phone on file: {phone ?? "Not set"}</p>
        </div>

        {hardStopBlocked ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You previously texted STOP, which hard-blocks SMS delivery regardless of the toggle below. Text
            START to your organization&apos;s number to lift the block.
          </div>
        ) : null}

        {smsOptOutDate ? (
          <p className="text-xs text-slate-500">Consent was previously withdrawn on {new Date(smsOptOutDate).toLocaleString()}.</p>
        ) : null}

        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">SMS notifications</p>
            <p className={helperTextClassName}>Pause or resume texts without withdrawing your consent.</p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={togglePending}
            aria-pressed={commsSmsEnabled}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
              commsSmsEnabled ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
            }`}
          >
            {commsSmsEnabled ? "On" : "Off"}
          </button>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setView("verify");
              setConsentChecked(false);
              setError(null);
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Change phone number
          </button>
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={submitting}
            className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Withdraw consent
          </button>
        </div>
      </div>
    );
  }

  if (view === "code") {
    return (
      <form className="space-y-4" onSubmit={handleConfirmCode}>
        {notice ? <p className="text-sm text-slate-600">{notice}</p> : null}
        <label className="block space-y-1 text-sm font-medium text-slate-900">
          <span>Verification code</span>
          <input
            required
            inputMode="numeric"
            maxLength={6}
            className={fieldClassName}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit code"
          />
        </label>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        <div className="flex gap-3">
          <button
            disabled={submitting}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? "Confirming..." : "Confirm code"}
          </button>
          <button
            type="button"
            onClick={() => setView("verify")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSendCode}>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Mobile phone number</span>
        <input
          required
          type="tel"
          autoComplete="tel"
          className={fieldClassName}
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="+15551234567"
        />
      </label>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
          />
          <span>{SMS_CONSENT_TEXT}</span>
        </label>
        <p className="pl-7 text-xs text-slate-500">
          <Link href="/privacy" target="_blank" className="font-medium text-emerald-700 hover:underline">
            Privacy Policy
          </Link>
          {" · "}
          <Link href="/terms" target="_blank" className="font-medium text-emerald-700 hover:underline">
            Terms of Service
          </Link>
        </p>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="flex gap-3">
        <button
          disabled={submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {submitting ? "Sending..." : "Send verification code"}
        </button>
        {smsOptIn ? (
          <button
            type="button"
            onClick={() => setView("status")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
