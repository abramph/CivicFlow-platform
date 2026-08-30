"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatOrgWallTime, formatOrgWallTimeEndOfDayInclusive } from "@/lib/labs/pta/volunteer-hours/timezone";

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
  /** FC-6: the period's own snapshotted IANA zone — every date on this
   * period is displayed/edited in this zone, not the browser's or the
   * server's. */
  timezone: string;
  /** RV-4: buyout policy limits — see docs/pta-volunteer-hours-date-semantics.md's
   * sibling doc for the enforcement details; all four are server-enforced
   * at quote/checkout time (elections.ts: buildBuyoutQuote), not decorative. */
  buyoutFullAllowed: boolean;
  buyoutMinPurchaseMinutes: number | null;
  buyoutMaxPurchaseMinutes: number | null;
  buyoutMinServiceMinutes: number | null;
  buyoutIncrementMinutes: number;
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

function toDateInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  return formatOrgWallTime(iso, timezone, false);
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
  /** RV-4: hours strings for display/entry — always converted to/from
   * integer minutes at the form boundary (formToPayload/periodToForm),
   * exactly like requiredHours already does. Empty string = no limit. */
  buyoutFullAllowed: boolean;
  buyoutMinPurchaseHours: string;
  buyoutMaxPurchaseHours: string;
  buyoutMinServiceHours: string;
  buyoutIncrementMinutes: "15" | "30" | "60";
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
  buyoutFullAllowed: true,
  buyoutMinPurchaseHours: "",
  buyoutMaxPurchaseHours: "",
  buyoutMinServiceHours: "",
  buyoutIncrementMinutes: "60",
};

function minutesToHoursInputValue(minutes: number | null): string {
  return minutes == null ? "" : String(minutes / 60);
}

/** RV-6: buyoutWindowEnd's display-direction inverse — shows the admin the
 * LAST BUYABLE day they'd expect to see back (the day they originally
 * typed), not the exclusive following-day instant the server actually
 * stores. Round-trips exactly with the server's resolveOrgWallTimeEndOfDayToUtc. */
function toEndOfDayInclusiveDateInputValue(iso: string | null, timezone: string): string {
  if (!iso) return "";
  return formatOrgWallTimeEndOfDayInclusive(iso, timezone);
}

function hoursInputToMinutesOrNull(hoursValue: string): number | null {
  const trimmed = hoursValue.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 60) : null;
}

function periodToForm(period: VolunteerRequirementPeriodLike): FormState {
  return {
    name: period.name,
    periodType: period.periodType,
    startsOn: toDateInputValue(period.startsOn, period.timezone),
    endsOn: toDateInputValue(period.endsOn, period.timezone),
    requiredHours: String(period.requiredMinutesDefault / 60),
    volunteerDeadline: toDateInputValue(period.volunteerDeadline, period.timezone),
    buyoutWindowStart: toDateInputValue(period.buyoutWindowStart, period.timezone),
    buyoutWindowEnd: toEndOfDayInclusiveDateInputValue(period.buyoutWindowEnd, period.timezone),
    assessmentDate: toDateInputValue(period.assessmentDate, period.timezone),
    assessmentPaymentDueDate: toDateInputValue(period.assessmentPaymentDueDate, period.timezone),
    status: period.status,
    adminNotes: period.adminNotes ?? "",
    familyPolicyText: period.familyPolicyText ?? "",
    scopeLabel: period.scopeLabel ?? "",
    buyoutFullAllowed: period.buyoutFullAllowed,
    buyoutMinPurchaseHours: minutesToHoursInputValue(period.buyoutMinPurchaseMinutes),
    buyoutMaxPurchaseHours: minutesToHoursInputValue(period.buyoutMaxPurchaseMinutes),
    buyoutMinServiceHours: minutesToHoursInputValue(period.buyoutMinServiceMinutes),
    buyoutIncrementMinutes: String(period.buyoutIncrementMinutes) as FormState["buyoutIncrementMinutes"],
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
    buyoutFullAllowed: form.buyoutFullAllowed,
    buyoutMinPurchaseMinutes: hoursInputToMinutesOrNull(form.buyoutMinPurchaseHours),
    buyoutMaxPurchaseMinutes: hoursInputToMinutesOrNull(form.buyoutMaxPurchaseHours),
    buyoutMinServiceMinutes: hoursInputToMinutesOrNull(form.buyoutMinServiceHours),
    buyoutIncrementMinutes: Number(form.buyoutIncrementMinutes),
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
          <span className="block text-xs font-normal text-slate-500">
            Informational — drives the days-remaining countdown families see and deadline-reminder notifications (if
            enabled). Does not itself block hour submission or buying out hours after this date.
          </span>
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
          <span className="block text-xs font-normal text-slate-500">
            Enforced server-side: buying out hours opens at the very start of the &ldquo;start&rdquo; date and stays
            open through the very end (11:59pm, the organization&apos;s local time) of the &ldquo;end&rdquo; date —
            the end date you choose here is the LAST buyable day, not excluded from it. A checkout attempted outside
            this window is rejected regardless of what the browser shows. Leave both blank for no period-level
            restriction (only each pricing window&apos;s own dates then apply).
          </span>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Remaining-hours assessment date</span>
          <input
            type="date"
            value={form.assessmentDate}
            onChange={(e) => setForm({ ...form, assessmentDate: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="block text-xs font-normal text-slate-500">
            Enforced server-side: an administrator can preview an assessment batch at any time (a preview never
            charges anyone), but cannot POST it — creating real charges — before this date. Leave blank for no
            cutoff.
          </span>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Assessment payment due date</span>
          <input
            type="date"
            value={form.assessmentPaymentDueDate}
            onChange={(e) => setForm({ ...form, assessmentPaymentDueDate: e.target.value })}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="block text-xs font-normal text-slate-500">
            Informational only — shown to families as the due date on a posted charge and in payment-reminder
            notifications (if enabled). Nothing automatically happens if this date passes unpaid; there is no late
            fee or auto-escalation.
          </span>
        </label>
      </div>

      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-900">Buyout policy limits</legend>
        <p className="text-xs text-slate-500">
          Every field below is enforced server-side at quote and checkout time — not just UI guidance. Hours are
          shown here for convenience; they&apos;re stored (and validated) as whole minutes.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.buyoutFullAllowed}
              onChange={(e) => setForm({ ...form, buyoutFullAllowed: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Allow a full buyout (pay for the entire requirement at once)</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Purchase increment</span>
            <select
              value={form.buyoutIncrementMinutes}
              onChange={(e) => setForm({ ...form, buyoutIncrementMinutes: e.target.value as FormState["buyoutIncrementMinutes"] })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="60">Whole hours</option>
              <option value="30">Half hours</option>
              <option value="15">Quarter hours</option>
            </select>
            <span className="block text-xs font-normal text-slate-500">
              Every partial-buyout purchase must be an exact multiple of this.
            </span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Minimum purchase (hours)</span>
            <input
              type="number"
              min={0}
              step="0.25"
              value={form.buyoutMinPurchaseHours}
              onChange={(e) => setForm({ ...form, buyoutMinPurchaseHours: e.target.value })}
              placeholder="No minimum beyond one increment"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-xs font-normal text-slate-500">Smallest partial buyout a family may choose. Leave blank for no minimum.</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>Maximum purchase (hours)</span>
            <input
              type="number"
              min={0}
              step="0.25"
              value={form.buyoutMaxPurchaseHours}
              onChange={(e) => setForm({ ...form, buyoutMaxPurchaseHours: e.target.value })}
              placeholder="Up to the full requirement"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-xs font-normal text-slate-500">
              Largest partial buyout a family may choose. Can&apos;t exceed the required hours above minus the
              mandatory-service floor below. Leave blank for no cap beyond that.
            </span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900 md:col-span-2">
            <span>Mandatory-service floor (hours)</span>
            <input
              type="number"
              min={0}
              step="0.25"
              value={form.buyoutMinServiceHours}
              onChange={(e) => setForm({ ...form, buyoutMinServiceHours: e.target.value })}
              placeholder="No mandatory-service requirement"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-xs font-normal text-slate-500">
              Hours that must come from actual service no matter how much a family buys out — caps every buyout at
              (required hours − this value). Setting this above 0 also disables full buyout for this period (the two
              are contradictory).
            </span>
          </label>
        </div>
      </fieldset>

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
                    {PERIOD_TYPE_LABEL[period.periodType]} · {toDateInputValue(period.startsOn, period.timezone)} –{" "}
                    {toDateInputValue(period.endsOn, period.timezone)} · {(period.requiredMinutesDefault / 60).toString()} required hours
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/labs/pta/settings/volunteer-hours/periods/${period.id}`}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
                  >
                    Assignment rules
                  </Link>
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
                </div>
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
