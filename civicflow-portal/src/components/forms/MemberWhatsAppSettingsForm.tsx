"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { fieldClassName, helperTextClassName } from "@/components/forms/formStyles";
import { isValidE164Phone } from "@/lib/phone";
import { WHATSAPP_CONSENT_TEXT } from "@/lib/whatsapp-consent-text";

type View = "status" | "optin";

export function MemberWhatsAppSettingsForm({
  organizationId,
  whatsappPhoneNumber,
  whatsappOptInStatus,
  whatsappOptedInAt,
  whatsappOptedOutAt,
  whatsappEnabled,
}: {
  organizationId: string;
  whatsappPhoneNumber: string | null;
  whatsappOptInStatus: "NOT_STARTED" | "OPTED_IN" | "OPTED_OUT";
  whatsappOptedInAt: string | null;
  whatsappOptedOutAt: string | null;
  whatsappEnabled: boolean;
}) {
  const router = useRouter();
  const isOptedIn = whatsappOptInStatus === "OPTED_IN";
  const hardStopBlocked = Boolean(whatsappOptedOutAt) && whatsappOptInStatus === "OPTED_OUT";
  const [view, setView] = useState<View>(isOptedIn ? "status" : "optin");
  const [phoneInput, setPhoneInput] = useState(whatsappPhoneNumber ?? "");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState(false);

  async function handleOptIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!isValidE164Phone(phoneInput.trim())) {
      setError("Enter a valid phone number in international format, e.g. +15551234567.");
      return;
    }
    if (!consentChecked) {
      setError("You must check the consent box to receive WhatsApp notifications.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/member-portal/notifications/whatsapp/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, phone: phoneInput.trim(), consentAccepted: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to opt in.");
        return;
      }
      setView("status");
      router.refresh();
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
      const res = await fetch("/api/member-portal/notifications/whatsapp/toggle", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, enabled: !whatsappEnabled }),
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
    if (!window.confirm("Withdraw WhatsApp consent? You'll need to opt in again to receive WhatsApp messages.")) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/member-portal/notifications/whatsapp/withdraw", {
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
      setView("optin");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (view === "status" && isOptedIn) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">WhatsApp consent on file</p>
          <p className="mt-1 text-sm text-emerald-800">
            Opted in {whatsappOptedInAt ? new Date(whatsappOptedInAt).toLocaleString() : ""}.
          </p>
          <p className="mt-1 text-sm text-emerald-800">Number on file: {whatsappPhoneNumber ?? "Not set"}</p>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-slate-900">WhatsApp notifications</p>
            <p className={helperTextClassName}>Pause or resume WhatsApp messages without withdrawing your consent.</p>
          </div>
          <button
            type="button"
            onClick={handleToggle}
            disabled={togglePending}
            aria-pressed={whatsappEnabled}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition disabled:opacity-60 ${
              whatsappEnabled ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
            }`}
          >
            {whatsappEnabled ? "On" : "Off"}
          </button>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <button
          type="button"
          onClick={handleWithdraw}
          disabled={submitting}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          Withdraw consent
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleOptIn}>
      {hardStopBlocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          You previously texted STOP, which blocks WhatsApp delivery. Opting in again below records fresh consent.
        </div>
      ) : null}
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>WhatsApp number</span>
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
          <span>{WHATSAPP_CONSENT_TEXT}</span>
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
          {submitting ? "Opting in..." : "Opt in to WhatsApp"}
        </button>
        {isOptedIn ? (
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
