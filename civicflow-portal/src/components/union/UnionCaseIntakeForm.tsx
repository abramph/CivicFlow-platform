"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Friendly labels for the same free-text caseType vocabulary the staff
// dashboard uses (GRIEVANCE/DISCIPLINE/SAFETY/CONTRACT_VIOLATION/
// SCHEDULING/HARASSMENT/GENERAL_ISSUE/OTHER) -- a member picks by what
// happened, not by grievance-procedure terminology. Submitting here never
// files a formal grievance on its own (UnionCase.isFormalGrievance stays
// false until a steward makes that call); this form doesn't even expose
// the concept.
const CASE_TYPES = [
  { value: "GENERAL_ISSUE", label: "Something else going on" },
  { value: "DISCIPLINE", label: "Discipline or write-up" },
  { value: "SAFETY", label: "Safety concern" },
  { value: "CONTRACT_VIOLATION", label: "Contract violation" },
  { value: "SCHEDULING", label: "Scheduling or hours" },
  { value: "HARASSMENT", label: "Harassment or mistreatment" },
  { value: "GRIEVANCE", label: "I want to file a grievance" },
  { value: "OTHER", label: "Other" },
];

export function UnionCaseIntakeForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [caseType, setCaseType] = useState(CASE_TYPES[0].value);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [representationRequested, setRepresentationRequested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/union/cases/my", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          caseType,
          title,
          description,
          incidentDate: incidentDate ? new Date(incidentDate).toISOString() : null,
          representationRequested,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to submit this.");
        return;
      }
      router.push(`/m/union/cases/${data.data.id}`);
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>What&apos;s this about?</span>
        <select value={caseType} onChange={(e) => setCaseType(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
          {CASE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Short summary</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A few words about what happened"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Tell us what happened</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="As much detail as you can share -- dates, who was involved, what you'd like to see happen."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-slate-900">
        <span>Date it happened (optional)</span>
        <input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-auto" />
      </label>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={representationRequested} onChange={(e) => setRepresentationRequested(e.target.checked)} className="rounded border-slate-300" />
        I&apos;d like a steward to represent me on this
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={pending || !title.trim() || !description.trim()}
        onClick={submit}
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Submitting…" : "Submit"}
      </button>
    </div>
  );
}
