"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PtaProfileLike {
  schoolOrPtaName: string;
  designation: "PTA" | "PTO";
  currentSchoolYear: string;
  schoolAddress?: string | null;
  schoolWebsite?: string | null;
  principalName?: string | null;
  contactEmail?: string | null;
  membershipModel: "INDIVIDUAL" | "HOUSEHOLD" | "FAMILY";
  defaultDuesAmountCents?: number | null;
  gradesServed: string[];
  concernsEnabled?: boolean;
  concernsLabel?: string | null;
  electionsEnabled?: boolean;
}

/** `canManageConcerns` — PTA-E: the concerns feature switch is governance
 * surface held to pta:concerns:manage (ORG_ADMIN+). When false, the fields
 * are hidden AND omitted from the payload so a staff-level profile save can
 * never touch (or be rejected because of) them. */
export function PtaProfileForm({
  initialProfile,
  canManageConcerns = false,
  canManageElections = false,
}: {
  initialProfile: PtaProfileLike | null;
  canManageConcerns?: boolean;
  canManageElections?: boolean;
}) {
  const router = useRouter();
  const [schoolOrPtaName, setSchoolOrPtaName] = useState(initialProfile?.schoolOrPtaName ?? "");
  const [designation, setDesignation] = useState<"PTA" | "PTO">(initialProfile?.designation ?? "PTA");
  const [currentSchoolYear, setCurrentSchoolYear] = useState(initialProfile?.currentSchoolYear ?? "");
  const [schoolAddress, setSchoolAddress] = useState(initialProfile?.schoolAddress ?? "");
  const [schoolWebsite, setSchoolWebsite] = useState(initialProfile?.schoolWebsite ?? "");
  const [principalName, setPrincipalName] = useState(initialProfile?.principalName ?? "");
  const [contactEmail, setContactEmail] = useState(initialProfile?.contactEmail ?? "");
  const [membershipModel, setMembershipModel] = useState<"INDIVIDUAL" | "HOUSEHOLD" | "FAMILY">(initialProfile?.membershipModel ?? "HOUSEHOLD");
  const [defaultDuesAmount, setDefaultDuesAmount] = useState(initialProfile?.defaultDuesAmountCents ? (initialProfile.defaultDuesAmountCents / 100).toString() : "");
  const [gradesServed, setGradesServed] = useState(initialProfile?.gradesServed?.join(", ") ?? "");
  const [concernsEnabled, setConcernsEnabled] = useState(initialProfile?.concernsEnabled ?? true);
  const [concernsLabel, setConcernsLabel] = useState(initialProfile?.concernsLabel ?? "");
  const [electionsEnabled, setElectionsEnabled] = useState(initialProfile?.electionsEnabled ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch("/api/labs/pta/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolOrPtaName,
          designation,
          currentSchoolYear,
          schoolAddress: schoolAddress || null,
          schoolWebsite: schoolWebsite || null,
          principalName: principalName || null,
          contactEmail: contactEmail || null,
          membershipModel,
          defaultDuesAmountCents: defaultDuesAmount ? Math.round(Number(defaultDuesAmount) * 100) : null,
          gradesServed: gradesServed.split(",").map((g) => g.trim()).filter(Boolean),
          ...(canManageConcerns ? { concernsEnabled, concernsLabel: concernsLabel.trim() || null } : {}),
          ...(canManageElections ? { electionsEnabled } : {}),
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
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>School or PTA name</span>
          <input value={schoolOrPtaName} onChange={(e) => setSchoolOrPtaName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Designation</span>
          <select value={designation} onChange={(e) => setDesignation(e.target.value as "PTA" | "PTO")} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="PTA">PTA</option>
            <option value="PTO">PTO</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Current school year</span>
          <input value={currentSchoolYear} onChange={(e) => setCurrentSchoolYear(e.target.value)} placeholder="2026-2027" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Membership model</span>
          <select value={membershipModel} onChange={(e) => setMembershipModel(e.target.value as typeof membershipModel)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="INDIVIDUAL">Individual</option>
            <option value="HOUSEHOLD">Household</option>
            <option value="FAMILY">Family</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>School address</span>
          <input value={schoolAddress} onChange={(e) => setSchoolAddress(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>School website</span>
          <input value={schoolWebsite} onChange={(e) => setSchoolWebsite(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Principal name (optional)</span>
          <input value={principalName} onChange={(e) => setPrincipalName(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>PTA contact email</span>
          <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Default annual dues amount ($)</span>
          <input value={defaultDuesAmount} onChange={(e) => setDefaultDuesAmount(e.target.value)} type="number" min={0} step="0.01" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-900">
          <span>Grades served (comma-separated)</span>
          <input value={gradesServed} onChange={(e) => setGradesServed(e.target.value)} placeholder="Kindergarten, 1st Grade, 2nd Grade" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
      </div>
      {canManageConcerns ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Concerns &amp; Grievances</h3>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={concernsEnabled} onChange={(e) => setConcernsEnabled(e.target.checked)} className="h-4 w-4" />
            <span>Enable the concerns module for this PTA</span>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-900">
            <span>What your PTA calls it (optional)</span>
            <input
              value={concernsLabel}
              onChange={(e) => setConcernsLabel(e.target.value)}
              placeholder="Concerns & Grievances"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="block text-xs font-normal text-slate-500">
              Shown in navigation and page titles — e.g. &quot;Member Feedback&quot; or &quot;Grievances&quot;. Turning the module off hides it everywhere; no case data is deleted.
            </span>
          </label>
        </div>
      ) : null}
      {canManageElections ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Elections</h3>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={electionsEnabled} onChange={(e) => setElectionsEnabled(e.target.checked)} className="h-4 w-4" />
            <span>Enable elections for this PTA</span>
          </label>
          <p className="text-xs font-normal text-slate-500">
            Off by default. Unestra elections are a tool for your own process — secret ballots are protected from ordinary
            administrator access, but Unestra makes no legal election-compliance claims. Follow your bylaws and state rules.
          </p>
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">Saved.</p> : null}
      <button type="button" disabled={pending} onClick={submit} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
        {pending ? "Saving..." : "Save PTA profile"}
      </button>
    </div>
  );
}
