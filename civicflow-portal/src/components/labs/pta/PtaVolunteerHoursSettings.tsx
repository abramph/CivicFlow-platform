"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FlagsLike {
  ptaVolunteerRequirementsEnabled: boolean;
  ptaVolunteerBuyoutEnabled: boolean;
  ptaVolunteerAssessmentsEnabled: boolean;
  ptaVolunteerReportsEnabled: boolean;
  ptaVolunteerNotificationsEnabled: boolean;
}

/**
 * Volunteer Hour Requirements & Buyout program (docs/pta-volunteer-hours.md).
 * Six independent flags — none of these toggles implies any other. Each
 * checkbox is hidden unless the signed-in officer holds that specific
 * capability's manage permission (mirrors PtaProfileForm's
 * canManageConcerns/canManageElections pattern), matching the server-side
 * per-flag permission split in /api/labs/pta/profile's PUT handler.
 */
export function PtaVolunteerHoursSettings({
  initialFlags,
  canManageRequirements,
  canManageBuyoutPricing,
  canManageAssessments,
  canManageReportsExport,
}: {
  initialFlags: FlagsLike | null;
  canManageRequirements: boolean;
  canManageBuyoutPricing: boolean;
  canManageAssessments: boolean;
  canManageReportsExport: boolean;
}) {
  const router = useRouter();
  const [requirementsEnabled, setRequirementsEnabled] = useState(initialFlags?.ptaVolunteerRequirementsEnabled ?? false);
  const [buyoutEnabled, setBuyoutEnabled] = useState(initialFlags?.ptaVolunteerBuyoutEnabled ?? false);
  const [assessmentsEnabled, setAssessmentsEnabled] = useState(initialFlags?.ptaVolunteerAssessmentsEnabled ?? false);
  const [reportsEnabled, setReportsEnabled] = useState(initialFlags?.ptaVolunteerReportsEnabled ?? false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(initialFlags?.ptaVolunteerNotificationsEnabled ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!canManageRequirements && !canManageBuyoutPricing && !canManageAssessments && !canManageReportsExport) {
    return null;
  }

  async function submit() {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/labs/pta/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The profile PUT endpoint requires the always-present fields too —
          // the server ignores unrelated changes when only flags are toggled
          // here (each flag has its own permission check independent of the
          // rest of this payload).
          ...(canManageRequirements ? { ptaVolunteerRequirementsEnabled: requirementsEnabled, ptaVolunteerNotificationsEnabled: notificationsEnabled } : {}),
          ...(canManageBuyoutPricing ? { ptaVolunteerBuyoutEnabled: buyoutEnabled } : {}),
          ...(canManageAssessments ? { ptaVolunteerAssessmentsEnabled: assessmentsEnabled } : {}),
          ...(canManageReportsExport ? { ptaVolunteerReportsEnabled: reportsEnabled } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Every switch below defaults off and stays off until you turn it on. Turning a switch off later hides that
        capability again but never deletes any hours, purchases, or payment history already recorded.
      </p>
      <div className="space-y-3">
        {canManageRequirements ? (
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={requirementsEnabled}
              onChange={(e) => setRequirementsEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Use volunteer hour requirements
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Master switch. Turns on requirement periods and the family volunteer-requirement dashboard. Required
                before any of the switches below can take effect.
              </span>
            </span>
          </label>
        ) : null}
        {canManageBuyoutPricing ? (
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={buyoutEnabled} onChange={(e) => setBuyoutEnabled(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              Allow families to pay for volunteer hours
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Turns on pricing windows and buyout purchases. Families never see a buyout option until this is on.
              </span>
            </span>
          </label>
        ) : null}
        {canManageAssessments ? (
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={assessmentsEnabled}
              onChange={(e) => setAssessmentsEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Allow remaining-hour assessments
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Turns on assessment preview and posting for hours left unmet at period end. Independent of the buyout
                switch above — you can price buyouts without authorizing assessment charges, or vice versa.
              </span>
            </span>
          </label>
        ) : null}
        {canManageReportsExport ? (
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={reportsEnabled} onChange={(e) => setReportsEnabled(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              Enable the Volunteer Reports center
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                On-screen reports and Excel/CSV downloads. Turning this on never turns on payments or assessments.
              </span>
            </span>
          </label>
        ) : null}
        {canManageRequirements ? (
          <label className="flex items-start gap-2 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => setNotificationsEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Send automated volunteer-hours notifications
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                Off by default even after everything else above is on. Officers can always preview and test-send
                templates to themselves regardless of this switch.
              </span>
            </span>
          </label>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-emerald-700">Saved.</p> : null}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save volunteer-hours settings"}
      </button>
    </div>
  );
}
