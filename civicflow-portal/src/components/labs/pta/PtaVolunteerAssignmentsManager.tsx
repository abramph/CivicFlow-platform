"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ScopeType = "ALL" | "MEMBERSHIP_PLAN" | "GRADE" | "CLASSROOM" | "PROGRAM" | "HOUSEHOLD";
type AssignmentType = "STANDARD" | "PER_CHILD" | "PER_ADULT" | "CUSTOM" | "REDUCED" | "EXEMPT_FULL" | "EXEMPT_TEMPORARY" | "WAIVER";

export interface AssignmentLike {
  id: string;
  scopeType: ScopeType;
  scopeRefId: string | null;
  householdId: string | null;
  assignmentType: AssignmentType;
  requiredMinutesOverride: number | null;
  reason: string | null;
  exemptUntil: string | null;
}

export interface PreviewRowLike {
  householdId: string;
  householdDisplayName: string;
  requiredMinutes: number;
  assignmentType: AssignmentType;
  matchedScopeType: ScopeType | null;
  exempt: boolean;
}

const SCOPE_LABEL: Record<ScopeType, string> = {
  ALL: "All active families",
  MEMBERSHIP_PLAN: "Membership plan (category id)",
  GRADE: "Grade (grade id)",
  CLASSROOM: "Classroom (classroom id)",
  PROGRAM: "Program group (label + household)",
  HOUSEHOLD: "Specific family (household id)",
};

const ASSIGNMENT_TYPE_LABEL: Record<AssignmentType, string> = {
  STANDARD: "Standard (period default)",
  PER_CHILD: "Per enrolled child",
  PER_ADULT: "Per adult member",
  CUSTOM: "Custom hours",
  REDUCED: "Reduced hours",
  EXEMPT_FULL: "Full exemption",
  EXEMPT_TEMPORARY: "Temporary exemption",
  WAIVER: "Administrative waiver",
};

function needsScopeRef(scope: ScopeType) {
  return scope === "GRADE" || scope === "CLASSROOM" || scope === "MEMBERSHIP_PLAN" || scope === "PROGRAM";
}
function needsHousehold(scope: ScopeType) {
  return scope === "HOUSEHOLD" || scope === "PROGRAM";
}
function needsOverride(type: AssignmentType) {
  return type === "CUSTOM" || type === "REDUCED";
}

/**
 * Volunteer Hour Requirements & Buyout program, VH-B (docs/pta-volunteer-hours.md).
 * Assignment-rule CRUD + the pre-activation preview table (spec §4). Scope
 * references (grade/classroom/category ids, household ids) are entered as
 * raw ids for now — a searchable picker is a follow-up UX improvement, not
 * a correctness gap (the server validates every id against this org).
 */
export function PtaVolunteerAssignmentsManager({
  periodId,
  assignments,
  canManageScopeRules,
  canAdjustFamily,
}: {
  periodId: string;
  assignments: AssignmentLike[];
  canManageScopeRules: boolean;
  canAdjustFamily: boolean;
}) {
  const router = useRouter();
  const [scopeType, setScopeType] = useState<ScopeType>("HOUSEHOLD");
  const [scopeRefId, setScopeRefId] = useState("");
  const [householdId, setHouseholdId] = useState("");
  const [assignmentType, setAssignmentType] = useState<AssignmentType>("EXEMPT_FULL");
  const [requiredHoursOverride, setRequiredHoursOverride] = useState("");
  const [reason, setReason] = useState("");
  const [exemptUntil, setExemptUntil] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewRowLike[] | null>(null);
  const [previewPending, setPreviewPending] = useState(false);

  const canCreateSelectedScope = needsHousehold(scopeType) ? canAdjustFamily : canManageScopeRules;

  async function createAssignment() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeRefId: needsScopeRef(scopeType) ? scopeRefId.trim() || null : null,
          householdId: needsHousehold(scopeType) ? householdId.trim() || null : null,
          assignmentType,
          requiredMinutesOverride: needsOverride(assignmentType) ? Math.round(Number(requiredHoursOverride || 0) * 60) : null,
          reason: reason.trim() || null,
          exemptUntil: assignmentType === "EXEMPT_TEMPORARY" ? exemptUntil || null : null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to create assignment.");
        return;
      }
      setScopeRefId("");
      setHouseholdId("");
      setRequiredHoursOverride("");
      setReason("");
      setExemptUntil("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function removeAssignment(assignmentId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/assignments/${assignmentId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to remove assignment.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function runPreview() {
    setPreviewPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/labs/pta/volunteer-hours/periods/${periodId}/preview`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to generate preview.");
        return;
      }
      setPreview(data.data);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPreviewPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Assignment rules</h3>
        <p className="mt-1 text-xs text-slate-500">
          The period&apos;s required hours apply to every active family unless a rule below says otherwise. Individual family
          rules always win; more specific scopes (classroom, then grade, then membership plan) win over broader ones.
        </p>
        {assignments.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No rules yet — every family gets the period default.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {assignments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{SCOPE_LABEL[a.scopeType]}</span>
                  {a.scopeRefId ? <span className="text-slate-500"> · {a.scopeRefId}</span> : null}
                  {a.householdId ? <span className="text-slate-500"> · household {a.householdId}</span> : null}
                  <span className="text-slate-500"> · {ASSIGNMENT_TYPE_LABEL[a.assignmentType]}</span>
                  {a.requiredMinutesOverride != null ? (
                    <span className="text-slate-500"> · {(a.requiredMinutesOverride / 60).toString()}h</span>
                  ) : null}
                  {a.reason ? <p className="text-xs text-slate-500">Reason: {a.reason}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => removeAssignment(a.id)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(canManageScopeRules || canAdjustFamily) && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="text-sm font-semibold text-slate-900">Add a rule</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Applies to</span>
              <select value={scopeType} onChange={(e) => setScopeType(e.target.value as ScopeType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {(Object.keys(SCOPE_LABEL) as ScopeType[]).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Rule type</span>
              <select value={assignmentType} onChange={(e) => setAssignmentType(e.target.value as AssignmentType)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {(Object.keys(ASSIGNMENT_TYPE_LABEL) as AssignmentType[]).map((t) => (
                  <option key={t} value={t}>
                    {ASSIGNMENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {needsScopeRef(scopeType) ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>{scopeType === "PROGRAM" ? "Program label" : "Id"}</span>
                <input value={scopeRefId} onChange={(e) => setScopeRefId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            ) : null}
            {needsHousehold(scopeType) ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>Household id</span>
                <input value={householdId} onChange={(e) => setHouseholdId(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            ) : null}
            {needsOverride(assignmentType) ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>Required hours</span>
                <input
                  type="number"
                  min={0}
                  step="0.25"
                  value={requiredHoursOverride}
                  onChange={(e) => setRequiredHoursOverride(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
            ) : null}
            {assignmentType === "EXEMPT_TEMPORARY" ? (
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>Exempt until</span>
                <input type="date" value={exemptUntil} onChange={(e) => setExemptUntil(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            ) : null}
          </div>
          <label className="block space-y-1 text-sm font-medium text-slate-900">
            <span>Reason {assignmentType === "STANDARD" ? "(optional)" : "(required)"}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button
            type="button"
            disabled={pending || !canCreateSelectedScope}
            onClick={createAssignment}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Add rule"}
          </button>
          {!canCreateSelectedScope ? (
            <p className="text-xs text-amber-700">
              You don&apos;t have permission to add a family-specific rule — ask an officer with family-adjustment authority.
            </p>
          ) : null}
        </div>
      )}

      <div>
        <button
          type="button"
          disabled={previewPending}
          onClick={runPreview}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
        >
          {previewPending ? "Generating..." : "Preview requirement for every family"}
        </button>
        {preview ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Family</th>
                  <th className="py-2 pr-4">Required hours</th>
                  <th className="py-2 pr-4">Basis</th>
                  <th className="py-2 pr-4">Exempt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((p) => (
                  <tr key={p.householdId}>
                    <td className="py-2 pr-4 font-medium text-slate-900">{p.householdDisplayName}</td>
                    <td className="py-2 pr-4">{(p.requiredMinutes / 60).toString()}h</td>
                    <td className="py-2 pr-4 text-slate-600">{ASSIGNMENT_TYPE_LABEL[p.assignmentType]}</td>
                    <td className="py-2 pr-4">{p.exempt ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length === 0 ? <p className="mt-2 text-sm text-slate-600">No active families yet.</p> : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
