"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FieldLike {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  targetEntity: string;
  targetField: string | null;
  sensitivity: string;
  options: string[];
}

const FIELD_TYPES = ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "ADDRESS", "DATE", "SELECT", "MULTISELECT", "CHECKBOX", "RADIO", "BOOLEAN", "NUMBER"];

const OPTIONS_TYPES = new Set(["SELECT", "MULTISELECT", "RADIO"]);

/** UI-only convenience list — the actual security enforcement is the
 * server-side allow-list in src/lib/member-intake/sensitivity.ts, which
 * rejects anything not on it regardless of what this dropdown offers. */
const MEMBER_TARGET_FIELDS: { value: string; label: string }[] = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "preferredName", label: "Preferred name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "dateOfBirth", label: "Date of birth" },
  { value: "gender", label: "Gender" },
  { value: "addressLine1", label: "Address line 1" },
  { value: "addressLine2", label: "Address line 2" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zipCode", label: "ZIP code" },
  { value: "country", label: "Country" },
  { value: "householdName", label: "Household name" },
  { value: "emergencyContactName", label: "Emergency contact name" },
  { value: "emergencyContactPhone", label: "Emergency contact phone" },
  { value: "commsPushEnabled", label: "Push notifications enabled" },
  { value: "commsEmailEnabled", label: "Email notifications enabled" },
  { value: "commsSmsEnabled", label: "SMS notifications enabled" },
];

const SENSITIVITY_BADGE: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-700",
  MODERATE: "bg-amber-100 text-amber-800",
  HIGH: "bg-red-100 text-red-800",
};

export function MemberIntakeFieldManager({ formId, fields, canManage }: { formId: string; fields: FieldLike[]; canManage: boolean }) {
  const router = useRouter();
  const [fieldKey, setFieldKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("TEXT");
  const [required, setRequired] = useState(false);
  const [targetEntity, setTargetEntity] = useState<"MEMBER" | "CUSTOM">("MEMBER");
  const [targetField, setTargetField] = useState(MEMBER_TARGET_FIELDS[0].value);
  const [optionsText, setOptionsText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addField() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: fieldKey.trim(),
          label: label.trim(),
          fieldType,
          required,
          order: fields.length,
          targetEntity,
          targetField: targetEntity === "MEMBER" ? targetField : null,
          options: OPTIONS_TYPES.has(fieldType)
            ? optionsText
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to add this field.");
        return;
      }
      setFieldKey("");
      setLabel("");
      setOptionsText("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function removeField(fieldId: string) {
    if (!window.confirm("Remove this field from the form?")) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-intake/forms/${formId}/fields/${fieldId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to remove this field.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      {fields.length === 0 ? (
        <p className="text-sm text-slate-600">No fields yet — add at least one below before publishing.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {fields.map((field) => (
            <li key={field.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {field.label} {field.required ? <span className="text-red-600">*</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {field.fieldType} · {field.targetEntity === "CUSTOM" ? "Custom question" : `Maps to ${field.targetField}`}{" "}
                  <span className={`ml-1 inline-flex rounded-full px-1.5 py-0.5 font-semibold ${SENSITIVITY_BADGE[field.sensitivity]}`}>
                    {field.sensitivity}
                  </span>
                </p>
              </div>
              {canManage ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeField(field.id)}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-sm font-semibold text-slate-900">Add a field</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Field key</span>
              <input
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                placeholder="firstName"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Label shown to the public</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="First name"
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Field type</span>
              <select
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Maps to</span>
              <select
                value={targetEntity}
                onChange={(e) => setTargetEntity(e.target.value as "MEMBER" | "CUSTOM")}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
              >
                <option value="MEMBER">A member record field</option>
                <option value="CUSTOM">Custom question (not stored on the member record)</option>
              </select>
            </label>
            {targetEntity === "MEMBER" ? (
              <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
                <span>Member field</span>
                <select
                  value={targetField}
                  onChange={(e) => setTargetField(e.target.value)}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
                >
                  {MEMBER_TARGET_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {OPTIONS_TYPES.has(fieldType) ? (
              <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
                <span>Options (one per line)</span>
                <textarea
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  rows={3}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
                />
              </label>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-900">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span>Required</span>
          </label>
          <button
            type="button"
            disabled={pending || !fieldKey.trim() || !label.trim()}
            onClick={addField}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Add field
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
