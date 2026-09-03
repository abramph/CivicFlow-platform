"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_LABELS: Record<string, string> = {
  PREPARING: "Preparing",
  PREVIEWED: "Previewed",
  COMMITTED: "Committed",
  CORRECTED: "Corrected",
  ROLLED_BACK: "Rolled back",
};

const OUTCOME_LABELS: Record<string, string> = {
  PROMOTE: "Promote",
  RETAIN: "Retain",
  GRADUATE: "Graduate",
  TRANSFER: "Transfer",
  WITHDRAW: "Withdraw",
  EXCLUDE: "Exclude",
  MANUAL: "Manual",
  NEEDS_REVIEW: "Needs review",
};

const EXCEPTION_OUTCOMES = ["RETAIN", "TRANSFER", "WITHDRAW", "EXCLUDE", "MANUAL"] as const;

interface YearOption {
  id: string;
  label: string;
}

interface RecordView {
  id: string;
  studentId: string;
  studentName: string;
  outcome: string;
  status: string;
  sourceClassroomId: string | null;
  targetGradeId: string | null;
  targetClassroomId: string | null;
  exceptionReason: string | null;
}

interface ActiveBatchView {
  id: string;
  status: string;
  notes: string | null;
  previewedAt: string | null;
  fromYearLabel: string;
  toYearLabel: string;
  classroomMappings: { sourceClassroomId: string; targetClassroomId: string }[];
  records: RecordView[];
}

interface ClassroomOption {
  id: string;
  name: string;
  gradeName: string;
}

/**
 * PTA/PTO Student Progression admin center. All rules (year ordering,
 * duplicate-batch prevention, promotion idempotency, the commit ceremony's
 * fresh-preview + idempotency-key requirements) are enforced server-side in
 * student-progression.ts — this component only hides controls the caller
 * cannot use and narrates the workflow, mirroring PtaTransitionCenter.
 */
export function PtaStudentProgressionCenter({
  canCommit,
  years,
  suggestedToLabel,
  activeBatch,
  sourceClassrooms,
  targetClassrooms,
  history,
}: {
  canCommit: boolean;
  years: YearOption[];
  suggestedToLabel: string | null;
  activeBatch: ActiveBatchView | null;
  sourceClassrooms: ClassroomOption[];
  targetClassrooms: ClassroomOption[];
  history: { id: string; fromYearLabel: string; toYearLabel: string; status: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromYearId, setFromYearId] = useState(years.find((y) => y.label !== suggestedToLabel)?.id ?? "");
  const [toYearId, setToYearId] = useState(years.find((y) => y.label === suggestedToLabel)?.id ?? "");
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, string>>(
    Object.fromEntries((activeBatch?.classroomMappings ?? []).map((m) => [m.sourceClassroomId, m.targetClassroomId]))
  );
  const [exceptionDrafts, setExceptionDrafts] = useState<Record<string, { outcome: string; targetGradeId: string; targetClassroomId: string }>>({});

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return false;
      }
      return true;
    } catch {
      setError("Unable to connect. Please try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function startBatch() {
    if (!fromYearId || !toYearId) {
      setError("Choose both a source and target school year.");
      return;
    }
    if (await call("/api/labs/pta/student-progression", { method: "POST", body: JSON.stringify({ fromSchoolYearId: fromYearId, toSchoolYearId: toYearId }) })) {
      router.refresh();
    }
  }

  async function saveMappings() {
    if (!activeBatch) return;
    const mappings = Object.entries(mappingDrafts)
      .filter(([, target]) => target)
      .map(([sourceClassroomId, targetClassroomId]) => ({ sourceClassroomId, targetClassroomId }));
    if (await call(`/api/labs/pta/student-progression/${activeBatch.id}/classroom-mappings`, { method: "PUT", body: JSON.stringify({ mappings }) })) {
      router.refresh();
    }
  }

  async function generatePreview() {
    if (!activeBatch) return;
    if (await call(`/api/labs/pta/student-progression/${activeBatch.id}/preview`, { method: "POST" })) {
      router.refresh();
    }
  }

  async function saveException(studentId: string) {
    if (!activeBatch) return;
    const draft = exceptionDrafts[studentId];
    if (!draft?.outcome) return;
    const body = {
      studentId,
      outcome: draft.outcome,
      targetGradeId: draft.targetGradeId || null,
      targetClassroomId: draft.targetClassroomId || null,
    };
    if (await call(`/api/labs/pta/student-progression/${activeBatch.id}/exceptions`, { method: "POST", body: JSON.stringify(body) })) {
      router.refresh();
    }
  }

  async function commitBatch() {
    if (!activeBatch?.previewedAt) return;
    const confirmMessage =
      needsReviewCount > 0
        ? `Commit this progression from ${activeBatch.fromYearLabel} to ${activeBatch.toYearLabel}? ${needsReviewCount} student${needsReviewCount === 1 ? "" : "s"} still marked "Needs review" will NOT be enrolled for ${activeBatch.toYearLabel} — resolve them first, or they can only be fixed afterward one at a time via record correction.`
        : `Commit this progression from ${activeBatch.fromYearLabel} to ${activeBatch.toYearLabel}? This creates real enrollment records for the target year.`;
    if (!window.confirm(confirmMessage)) return;
    const idempotencyKey = crypto.randomUUID();
    if (
      await call(`/api/labs/pta/student-progression/${activeBatch.id}/commit`, {
        method: "POST",
        body: JSON.stringify({ previewVersion: activeBatch.previewedAt, idempotencyKey }),
      })
    ) {
      router.refresh();
    }
  }

  async function rollbackBatch() {
    if (!activeBatch) return;
    if (!window.confirm("Roll back this progression? Target-year enrollments this batch created will be deactivated.")) return;
    if (await call(`/api/labs/pta/student-progression/${activeBatch.id}/rollback`, { method: "POST" })) {
      router.refresh();
    }
  }

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const record of activeBatch?.records ?? []) {
      counts[record.outcome] = (counts[record.outcome] ?? 0) + 1;
    }
    return counts;
  }, [activeBatch]);

  // NEEDS_REVIEW records are silently marked SKIPPED (no target-year
  // enrollment at all) at commit time — see commitProgressionBatch's own
  // handling. Nothing else in this UI stops an admin from committing while
  // some students are still unresolved, so the count is surfaced here and
  // folded into the confirm dialog below rather than only being visible as
  // an amber table row that's easy to miss in a long roster.
  const needsReviewCount = summary.NEEDS_REVIEW ?? 0;

  const classroomName = (id: string | null, options: ClassroomOption[]) => {
    if (!id) return "—";
    const found = options.find((c) => c.id === id);
    return found ? `${found.gradeName} — ${found.name}` : "—";
  };

  if (!activeBatch) {
    return (
      <div className="space-y-4">
        {error ? <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"><span className="font-semibold">Error: </span>{error}</div> : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">From year</span>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={fromYearId} onChange={(e) => setFromYearId(e.target.value)}>
              <option value="">Select…</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">To year</span>
            <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={toYearId} onChange={(e) => setToYearId(e.target.value)}>
              <option value="">Select…</option>
              {years.map((y) => (
                <option key={y.id} value={y.id}>{y.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !fromYearId || !toYearId}
            onClick={startBatch}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            Start progression
          </button>
        </div>
        {history.length > 0 ? (
          <div className="pt-4">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">History</h3>
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between py-2">
                  <span>{h.fromYearLabel} → {h.toYearLabel}</span>
                  <span className="text-slate-500">{STATUS_LABELS[h.status] ?? h.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const isPreviewed = activeBatch.status === "PREVIEWED";
  const isCommittedOrCorrected = activeBatch.status === "COMMITTED" || activeBatch.status === "CORRECTED";
  const canEditMappings = activeBatch.status === "PREPARING" || activeBatch.status === "PREVIEWED";

  return (
    <div className="space-y-6">
      {error ? <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"><span className="font-semibold">Error: </span>{error}</div> : null}

      <div className="flex items-center gap-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{STATUS_LABELS[activeBatch.status] ?? activeBatch.status}</span>
      </div>

      {canEditMappings ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Classroom mappings</h3>
          <p className="text-xs text-slate-500">Grade progression is automatic. Classroom assignment must be mapped here — a student with no mapping shows &quot;Needs review&quot; below.</p>
          {sourceClassrooms.length === 0 ? (
            <p className="text-sm text-slate-500">No classrooms found for {activeBatch.fromYearLabel}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-700">
                  <tr>
                    <th className="px-4 py-2">Source ({activeBatch.fromYearLabel})</th>
                    <th className="px-4 py-2">Target ({activeBatch.toYearLabel})</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceClassrooms.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">{c.gradeName} — {c.name}</td>
                      <td className="px-4 py-2">
                        <select
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          value={mappingDrafts[c.id] ?? ""}
                          onChange={(e) => setMappingDrafts((drafts) => ({ ...drafts, [c.id]: e.target.value }))}
                        >
                          <option value="">Not mapped</option>
                          {targetClassrooms.map((t) => (
                            <option key={t.id} value={t.id}>{t.gradeName} — {t.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={saveMappings} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60">
              Save mappings
            </button>
            <button type="button" disabled={pending} onClick={generatePreview} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
              {activeBatch.status === "PREVIEWED" ? "Refresh preview" : "Generate preview"}
            </button>
          </div>
        </section>
      ) : null}

      {activeBatch.records.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Preview</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(summary).map(([outcome, count]) => (
              <span key={outcome} className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
                {OUTCOME_LABELS[outcome] ?? outcome}: {count}
              </span>
            ))}
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">Total: {activeBatch.records.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-2">Student</th>
                  <th className="px-4 py-2">Outcome</th>
                  <th className="px-4 py-2">Target classroom</th>
                  {isPreviewed || isCommittedOrCorrected ? <th className="px-4 py-2">Resolve</th> : null}
                </tr>
              </thead>
              <tbody>
                {activeBatch.records.map((record) => {
                  const needsAttention = record.outcome === "NEEDS_REVIEW";
                  const draft = exceptionDrafts[record.studentId] ?? { outcome: "", targetGradeId: "", targetClassroomId: "" };
                  return (
                    <tr key={record.id} className={`border-t border-slate-100 ${needsAttention ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-2">{record.studentName}</td>
                      <td className="px-4 py-2">
                        <span className={needsAttention ? "font-semibold text-amber-800" : ""}>{OUTCOME_LABELS[record.outcome] ?? record.outcome}</span>
                        {record.exceptionReason ? <span className="ml-2 text-xs text-slate-500">({record.exceptionReason})</span> : null}
                      </td>
                      <td className="px-4 py-2">{classroomName(record.targetClassroomId, targetClassrooms)}</td>
                      {canEditMappings ? (
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <select
                              className="rounded border border-slate-300 px-1 py-1 text-xs"
                              value={draft.outcome}
                              onChange={(e) => setExceptionDrafts((drafts) => ({ ...drafts, [record.studentId]: { ...draft, outcome: e.target.value } }))}
                            >
                              <option value="">Override…</option>
                              {EXCEPTION_OUTCOMES.map((o) => (
                                <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={pending || !draft.outcome}
                              onClick={() => saveException(record.studentId)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Save
                            </button>
                          </div>
                        </td>
                      ) : isCommittedOrCorrected ? (
                        <td className="px-4 py-2 text-xs text-slate-500">Use record correction to change after commit.</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {isPreviewed && needsReviewCount > 0 ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">{needsReviewCount} student{needsReviewCount === 1 ? "" : "s"} need{needsReviewCount === 1 ? "s" : ""} review. </span>
          Committing now will not enroll {needsReviewCount === 1 ? "this student" : "these students"} for {activeBatch.toYearLabel} — resolve the classroom mapping or set an exception above first, or plan to use record correction afterward.
        </div>
      ) : null}

      <div className="flex gap-2">
        {canCommit && isPreviewed ? (
          <button type="button" disabled={pending} onClick={commitBatch} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
            Commit progression
          </button>
        ) : null}
        {canCommit && isCommittedOrCorrected ? (
          <button type="button" disabled={pending} onClick={rollbackBatch} className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
            Roll back
          </button>
        ) : null}
      </div>

      {history.length > 0 ? (
        <div className="pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">History</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2">
                <span>{h.fromYearLabel} → {h.toYearLabel}</span>
                <span className="text-slate-500">{STATUS_LABELS[h.status] ?? h.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
