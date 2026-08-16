"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Settings {
  requireVerificationForExisting: boolean;
  autoCreateNewMember: boolean;
  autoApplySafeUpdates: boolean;
  requireReviewForSensitiveUpdates: boolean;
  duplicateHandlingMode: "REVIEW" | "AUTO_LINK_CONFIDENT";
}

export function MemberIntakeSettingsForm({ formId, settings, canManage }: { formId: string; settings: Settings; canManage: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState(settings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save these settings.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <fieldset disabled={!canManage} className="space-y-4 disabled:opacity-60">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={values.requireVerificationForExisting}
          onChange={(e) => setValues((v) => ({ ...v, requireVerificationForExisting: e.target.checked }))}
          className="mt-1"
        />
        <span className="text-sm text-slate-900">
          <span className="font-semibold">Require identity verification for existing members.</span>{" "}
          <span className="text-slate-600">
            A one-time code is sent to the member&apos;s email or phone already on file before any change is applied. Strongly recommended — leaving
            this off means a submission can be linked to an existing member without proving they control that identity.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={values.autoCreateNewMember}
          onChange={(e) => setValues((v) => ({ ...v, autoCreateNewMember: e.target.checked }))}
          className="mt-1"
        />
        <span className="text-sm text-slate-900">
          <span className="font-semibold">Automatically create a new member record</span>{" "}
          <span className="text-slate-600">when a submission doesn&apos;t match anyone existing. If off, new-person submissions wait in your review queue.</span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={values.autoApplySafeUpdates}
          onChange={(e) => setValues((v) => ({ ...v, autoApplySafeUpdates: e.target.checked }))}
          className="mt-1"
        />
        <span className="text-sm text-slate-900">
          <span className="font-semibold">Automatically apply low-sensitivity updates</span>{" "}
          <span className="text-slate-600">(like a preferred name or secondary phone) once identity is verified. Sensitive fields — legal name, email, date of birth — never auto-apply, regardless of this setting.</span>
        </span>
      </label>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={values.requireReviewForSensitiveUpdates}
          onChange={(e) => setValues((v) => ({ ...v, requireReviewForSensitiveUpdates: e.target.checked }))}
          className="mt-1"
        />
        <span className="text-sm text-slate-900">
          <span className="font-semibold">Require admin review for moderate-sensitivity updates</span>{" "}
          <span className="text-slate-600">(like address or primary phone), even after verification.</span>
        </span>
      </label>

      <label className="block max-w-sm space-y-1 text-sm font-medium text-slate-900">
        <span>When a submission confidently matches an existing member</span>
        <select
          value={values.duplicateHandlingMode}
          onChange={(e) => setValues((v) => ({ ...v, duplicateHandlingMode: e.target.value as Settings["duplicateHandlingMode"] }))}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
        >
          <option value="REVIEW">Always send to admin review</option>
          <option value="AUTO_LINK_CONFIDENT">Link automatically (still gated by verification above)</option>
        </select>
        <span className="block text-xs font-normal text-slate-500">
          A possible or ambiguous match always goes to review, regardless of this setting — this only affects confident matches.
        </span>
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save settings"}
        </button>
        {saved ? <span className="text-sm font-medium text-emerald-700">Saved.</span> : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
