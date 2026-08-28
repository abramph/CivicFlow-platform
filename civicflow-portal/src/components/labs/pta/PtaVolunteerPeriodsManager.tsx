"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface VolunteerRequirementPeriodLike {
  id: string;
  name: string;
  periodType: "SCHOOL_YEAR" | "TERM" | "CALENDAR_YEAR" | "MEMBERSHIP_YEAR" | "CONTRACT_PERIOD" | "CUSTOM";
  startsOn: string;
  endsOn: string;
  requiredMinutesDefault: number;
  volunteerDeadline: string | null;
  buyoutWindowStart: string | null;
  buyoutWindowEnd: string | null;
  assessmentDate: string | null;
  assessmentPaymentDueDate: string | null;
  status: "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED";
  adminNotes: string | null;
  familyPolicyText: string | null;
  scopeLabel: string | null;
}

const PERIOD_TYPE_LABEL: Record<VolunteerRequirementPeriodLike["periodType"], string> = {
  SCHOOL_YEAR: "School year",
  TERM: "Term / semester",
  CALENDAR_YEAR: "Calendar year",
  MEMBERSHIP_YEAR: "Membership year",
  CONTRACT_PERIOD: "Contract period",
  CUSTOM: "Custom range",
};

const STATUS_BADGE: Record<VolunteerRequirementPeriodLike["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

interface FormState {
  name: string;
  periodType: VolunteerRequirementPeriodLike["periodType"];
  startsOn: string;
  endsOn: string;
  requiredHours: string;
  volunteerDeadline: string;
  buyoutWindowStart: string;
  buyoutWindowEnd: string;
  assessmentDate: string;
  assessmentPaymentDueDate: string;
  status: VolunteerRequirementPeriodLike["status"];
  adminNotes: string;
  familyPolicyText: string;
  scopeLabel: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  periodType: "SCHOOL_YEAR",
  startsOn: "",
  endsOn: "",
  requiredHours: "20",
  volunteerDeadline: "",
  buyoutWindowStart: "",
  buyoutWindowEnd: "",
  assessmentDate: "",
  assessmentPaymentDueDate: "",
  status: "DRAFT",
  adminNotes: "",
  familyPolicyText: "",
  scopeLabel: "",
};

function periodToForm(period: VolunteerRequirementPeriodLike): FormState {
  return {
    name: period.name,
    periodType: period.periodType,
    startsOn: toDateInputValue(period.startsOn),
    endsOn: toDateInputValue(period.endsOn),
    requiredHours: String(period.requiredMinutesDefault / 60),
    volunteerDeadline: toDateInputValue(period.volunteerDeadline),
    buyoutWindowStart: toDateInputValue(period.buyoutWindowStart),
    buyoutWindowEnd: toDateInputValue(period.buyoutWindowEnd),
    assessmentDate: toDateInputValue(period.assessmentDate),
    assessmentPaymentDueDate: toDateInputValue(period.assessmentPaymentDueDate),
    status: period.status,
    adminNotes: period.adminNotes ?? "",
    familyPolicyText: period.familyPolicyText ?? "",
    scopeLabel: period.scopeLabel ?? "",
  };
}

function formToPayload(form: FormState) {
  return {
    name: form.name.trim(),
    periodType: form.periodType,
    startsOn: form.startsOn,
    endsOn: form.endsOn,
    requiredMinutesDefault: Math.round(Number(form.requiredHours || 0) * 60),
    volunteerDeadline: form.volunteerDeadline || null,
    buyoutWindowStart: form.buyoutWindowStart || null,
    buyoutWindowEnd: form.buyoutWindowEnd || null,
    assessmentDate: form.assessmentDate || null,
    assessmentPaymentDueDate: form.assessmentPaymentDueDate || null,
    status: form.status,
    adminNotes: form.adminNotes.trim() || null,
    familyPolicyText: form.familyPolicyText.trim() || null,
    scopeLabel: form.scopeLabel.trim() || null,
  };
}

function PeriodForm({
  form,
  setForm,
  onSave,
  onCancel,
  pending,
}: {
  form: FormState;
  setForm: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Period name</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="2026-2027 School Year"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Period type</span>
          <select
            value={form.periodType}
            onChange={(e) => setForm({ ...form, periodType: e.target.value as FormState["periodType"] })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {Object.entries(PERIOD_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Starts on</span>
          <input type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Ends on</span>
          <input type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Required hours per family</span>
          <input
            type="number"
            min={0}
            step="0.25"
            value={form.requiredHours}
            onChange={(e) => setForm({ ...form, requiredHours: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Status</span>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Volunteer completion deadline</span>
          <input
            type="date"
            value={form.volunteerDeadline}
            onChange={(e) => setForm({ ...form, volunteerDeadline: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Scope (optional — for concurrent periods)</span>
          <input
            value={form.scopeLabel}
            onChange={(e) => setForm({ ...form, scopeLabel: e.target.value })}
            placeholder="e.g. Elementary Campus"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="block text-xs font-normal text-slate-500">
            Only needed if this PTA runs more than one active period at once for separate programs, campuses, or
            membership types — give each its own scope so they don&apos;t conflict.
          </span>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Buyout window start</span>
          <input
            type="date"
            value={form.buyoutWindowStart}
            onChange={(e) => setForm({ ...form, buyoutWindowStart: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Buyout window end</span>
          <input
            type="date"
            value={form.buyoutWindowEnd}
            onChange={(e) => setForm({ ...form, buyoutWindowEnd: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Remaining-hours assessment date</span>
          <input
            type="date"
            value={form.assessmentDate}
            onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Assessment payment due date</span>
          <input
            type="date"
            value={form.assessmentPaymentDueDate}
            onChange={(e) => setForm({ ...form, assessmentPaymentDueDate: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Family-facing policy description</span>
        <textarea
          value={form.familyPolicyText}
          onChange={(e) => setForm({ ...form, familyPolicyText: e.target.value })}
          rows={3}
          placeholder="Shown to families on their volunteer-requirement dashboard."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Administrator notes (internal only)</span>
        <textarea
          value={form.adminNotes}
          onChange={(e) => setForm({ ...form, adminNotes: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !form.name.trim() || !form.startsOn || !form.endsOn}
          onClick={onSave}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save period"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-A (docs/pta-volunteer-hours.md).
 * Requirement-period CRUD. Assignment rules (per-child/per-adult/exemptions),
 * pricing windows, and the buyout/assessment machinery attach to a period in
 * later stages — this manager is deliberately period-only.
 */
export function PtaVolunteerPeriodsManager({ periods }: { periods: VolunteerRequirementPeriodLike[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPeriod() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/labs/pta/volunteer-hours/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(createForm)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create period.");
        return;
      }
      setCreating(false);
      setCreateForm(EMPTY_FORM);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function saveEdit(periodId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToPayload(editForm)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save period.");
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {periods.length === 0 && !creating ? (
        <p className="text-sm text-slate-600">No volunteer requirement periods yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {periods.map((period) =>
            editingId === period.id ? (
              <li key={period.id} className="py-3">
                <PeriodForm form={editForm} setForm={setEditForm} onSave={() => saveEdit(period.id)} onCancel={() => setEditingId(null)} pending={pending} />
              </li>
            ) : (
              <li key={period.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{period.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[period.status]}`}>{period.status}</span>
                    {period.scopeLabel ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{period.scopeLabel}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {PERIOD_TYPE_LABEL[period.periodType]} · {toDateInputValue(period.startsOn)} – {toDateInputValue(period.endsOn)} ·{" "}
                    {(period.requiredMinutesDefault / 60).toString()} required hours
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(period.id);
                    setEditForm(periodToForm(period));
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                >
                  Edit
                </button>
              </li>
            )
          )}
        </ul>
      )}

      {creating ? (
        <PeriodForm
          form={createForm}
          setForm={setCreateForm}
          onSave={createPeriod}
          onCancel={() => {
            setCreating(false);
            setCreateForm(EMPTY_FORM);
          }}
          pending={pending}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          New requirement period
        </button>
      )}
    </div>
  );
}
