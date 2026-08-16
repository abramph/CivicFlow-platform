"use client";

import { useState } from "react";
import type { PublicSubmitOutcome } from "@/app/api/public/member-intake/[token]/submit/route";

interface PublicField {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  order: number;
  placeholder: string | null;
  helpText: string | null;
  options: string[];
}

interface PublicForm {
  id: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  title: string;
  description: string | null;
  successMessage: string | null;
  fields: PublicField[];
}

type Stage = "FILL" | "VERIFY" | "DONE";

const OUTCOME_MESSAGE: Record<PublicSubmitOutcome, string> = {
  NEW_MEMBER_CREATED: "You're all set — welcome!",
  UPDATE_APPLIED: "Thanks — your information has been updated.",
  VERIFICATION_REQUIRED: "Almost there — verify it's really you.",
  REVIEW_REQUIRED: "Thanks — we received your submission and it's being reviewed.",
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PublicField;
  value: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
}) {
  const baseClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  switch (field.fieldType) {
    case "TEXTAREA":
      return (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          rows={3}
          className={baseClass}
        />
      );
    case "SELECT":
    case "RADIO":
      return (
        <select value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={baseClass}>
          <option value="" disabled>
            Select…
          </option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "MULTISELECT": {
      const selected = (value as string[]) ?? [];
      return (
        <div className="space-y-1.5">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-900">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={(e) => onChange(e.target.checked ? [...selected, option] : selected.filter((o) => o !== option))}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      );
    }
    case "CHECKBOX":
    case "BOOLEAN":
      return (
        <label className="flex items-center gap-2 text-sm text-slate-900">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span>Yes</span>
        </label>
      );
    case "DATE":
      return <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={baseClass} />;
    case "NUMBER":
      return <input type="number" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className={baseClass} />;
    case "EMAIL":
      return (
        <input
          type="email"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          className={baseClass}
        />
      );
    case "PHONE":
      return (
        <input
          type="tel"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? "215-555-0100"}
          className={baseClass}
        />
      );
    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? undefined}
          className={baseClass}
        />
      );
  }
}

export function PublicIntakeFormClient({ token, sourceToken, form }: { token: string; sourceToken: string | null; form: PublicForm }) {
  const [values, setValues] = useState<Record<string, string | string[] | boolean>>({});
  const [stage, setStage] = useState<Stage>("FILL");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublicSubmitOutcome | null>(null);
  const [maskedDestination, setMaskedDestination] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const sortedFields = [...form.fields].sort((a, b) => a.order - b.order);

  function setFieldValue(fieldKey: string, value: string | string[] | boolean) {
    setValues((prev) => ({ ...prev, [fieldKey]: value }));
  }

  async function submit() {
    const missing = sortedFields.find((f) => f.required && !values[f.fieldKey]);
    if (missing) {
      setError(`"${missing.label}" is required.`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/member-intake/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: values, sourceToken }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // Preserve everything already entered -- never reset `values` here.
        setError(data?.error || "Something went wrong. Please check your answers and try again.");
        return;
      }
      setSubmissionId(data.data.submissionId);
      setOutcome(data.data.outcome);
      if (data.data.outcome === "VERIFICATION_REQUIRED") {
        setMaskedDestination(data.data.verification?.maskedDestination ?? null);
        setStage("VERIFY");
      } else {
        setStage("DONE");
      }
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function confirmCode() {
    if (!submissionId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/member-intake/${token}/verify/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, code: code.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "That code didn't work. Please try again.");
        return;
      }
      setOutcome(data.data.outcome);
      setStage("DONE");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function resendCode() {
    if (!submissionId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/member-intake/${token}/verify/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to resend a code right now.");
        return;
      }
      setMaskedDestination(data.data.maskedDestination ?? maskedDestination);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-slate-500">{form.organizationName}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">{form.title}</h1>
          {form.description ? <p className="mt-3 text-sm leading-6 text-slate-700">{form.description}</p> : null}
        </div>

        {stage === "FILL" ? (
          <div className="space-y-4">
            {sortedFields.map((field) => (
              <label key={field.id} className="block space-y-1 text-sm font-medium text-slate-900">
                <span>
                  {field.label} {field.required ? <span className="text-red-600">*</span> : null}
                </span>
                <FieldInput field={field} value={values[field.fieldKey]} onChange={(v) => setFieldValue(field.fieldKey, v)} />
                {field.helpText ? <span className="block text-xs font-normal text-slate-500">{field.helpText}</span> : null}
              </label>
            ))}

            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Submitting…" : "Submit"}
            </button>
          </div>
        ) : null}

        {stage === "VERIFY" ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              We need to verify it&apos;s really you before updating your information. We sent a code
              {maskedDestination ? <> to <span className="font-semibold">{maskedDestination}</span></> : null}.
            </p>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Verification code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-lg tracking-widest text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              />
            </label>
            <button
              type="button"
              disabled={pending || !code.trim()}
              onClick={confirmCode}
              className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {pending ? "Verifying…" : "Verify"}
            </button>
            <button type="button" disabled={pending} onClick={resendCode} className="w-full text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50">
              Resend code
            </button>
          </div>
        ) : null}

        {stage === "DONE" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-900">
            {form.successMessage || (outcome ? OUTCOME_MESSAGE[outcome] : "Thanks for submitting.")}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
