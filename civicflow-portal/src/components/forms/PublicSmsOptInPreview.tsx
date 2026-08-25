"use client";

import Link from "next/link";
import { useState } from "react";
import { fieldClassName } from "@/components/forms/formStyles";
import { isValidE164Phone } from "@/lib/phone";
import { SMS_CONSENT_TEXT } from "@/lib/sms-consent-text";

/**
 * Shows the real SMS consent mechanism (phone field, unchecked checkbox,
 * full disclosure text, Privacy/Terms links) to visitors who can't complete
 * it yet -- either signed out, or signed in but not yet a member of this
 * organization. Consent can only ever be recorded against an existing
 * OrgMember (see recordSmsOptIn in sms-consent.ts), so this renders the same
 * copy as MemberNotificationSettingsForm rather than a separate, divergent
 * flow -- it exists so the opt-in language and mechanism are visible to
 * anyone who lands here, not only to someone already logged in as a member.
 */
export function PublicSmsOptInPreview({ disabled = false }: { disabled?: boolean }) {
  const [phoneInput, setPhoneInput] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const phoneValid = phoneInput.trim().length === 0 || isValidE164Phone(phoneInput.trim());

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Mobile phone number</span>
        <input
          type="tel"
          autoComplete="tel"
          disabled={disabled}
          className={fieldClassName}
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          placeholder="+15551234567"
        />
        {!phoneValid ? (
          <span className="block text-xs text-red-600">
            Enter a valid phone number in international format, e.g. +15551234567.
          </span>
        ) : null}
      </label>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            disabled={disabled}
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
    </div>
  );
}
