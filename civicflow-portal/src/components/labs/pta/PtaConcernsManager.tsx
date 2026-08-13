"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORY_LABELS: Record<string, string> = {
  BYLAWS_CONCERN: "Bylaws concern",
  OFFICER_CONDUCT: "Officer conduct",
  MEMBER_CONDUCT: "Member conduct",
  ELECTION_CONCERN: "Election concern",
  FINANCIAL_CONCERN: "Financial concern",
  VOLUNTEER_CONCERN: "Volunteer concern",
  EVENT_ISSUE: "Event issue",
  POLICY_VIOLATION: "Policy violation",
  CONFLICT_OF_INTEREST: "Conflict of interest",
  MEMBERSHIP_DISPUTE: "Membership dispute",
  OTHER: "Other",
};

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  INFORMAL_RESOLUTION: "Informal resolution",
  FORMAL_REVIEW: "Formal review",
  AWAITING_RESPONSE: "Awaiting response",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
  APPEALED: "Appealed",
  CLOSED: "Closed",
};

const NOTE_KIND_LABELS: Record<string, string> = {
  NOTE: "Internal note",
  COMMUNICATION: "Communication",
  ACTION: "Action taken",
};

interface CaseRow {
  id: string;
  caseNumber: string;
  title: string;
  category: string;
  status: string;
  isRestricted: boolean;
  submittedAt: string;
  responseDeadline: string | null;
}

interface RedactedRow {
  id: string;
  caseNumber: string;
  category: string;
  status: string;
  submittedAt: string;
}

interface Officer {
  userId: string;
  name: string;
  role: string;
}

interface CaseDetail {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  category: string;
  status: string;
  isRestricted: boolean;
  reporterName: string | null;
  reporterContact: string | null;
  subjectName: string | null;
  incidentDate: string | null;
  submittedAt: string;
  responseDeadline: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  appealNotes: string | null;
  assignedCommittee: { id: string; name: string } | null;
  applicableGovernance: { id: string; title: string; version: number } | null;
  assignees: { userId: string; user: { id: string; displayName: string | null; email: string } }[];
  notes: { id: string; kind: string; body: string; createdAt: string; author: { displayName: string | null; email: string } | null }[];
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
}

function statusBadgeClass(status: string): string {
  if (status === "RESOLVED" || status === "CLOSED") return "bg-emerald-100 text-emerald-800";
  if (status === "DISMISSED") return "bg-slate-200 text-slate-700";
  if (status === "APPEALED") return "bg-amber-100 text-amber-800";
  return "bg-sky-100 text-sky-800";
}

/**
 * PTA Vertical 2.0, PR PTA-E — the officer-facing case register. Everything
 * here is a convenience over the API: the server enforces every access rule
 * (restricted-case wall, resolve/assign permissions), so this component only
 * hides controls the caller cannot use.
 */
export function PtaConcernsManager({
  featureLabel,
  cases,
  redactedCases,
  officers,
  committees,
  governanceDocuments,
  viewer,
}: {
  featureLabel: string;
  cases: CaseRow[];
  redactedCases: RedactedRow[];
  officers: Officer[];
  committees: { id: string; name: string }[];
  governanceDocuments: { id: string; label: string }[];
  viewer: { canManage: boolean; canAssign: boolean; canResolve: boolean };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<CaseDetail | null>(null);

  // Create-form state.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [isRestricted, setIsRestricted] = useState(false);
  const [reporterName, setReporterName] = useState("");
  const [reporterContact, setReporterContact] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [responseDeadline, setResponseDeadline] = useState("");
  const [committeeId, setCommitteeId] = useState("");
  const [governanceId, setGovernanceId] = useState("");

  // Detail working state.
  const [statusDraft, setStatusDraft] = useState("");
  const [resolutionDraft, setResolutionDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [noteKind, setNoteKind] = useState("NOTE");
  const [assignUserId, setAssignUserId] = useState("");

  async function call(path: string, init?: RequestInit): Promise<{ ok: boolean; data?: unknown }> {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return { ok: false };
      }
      return { ok: true, data: data.data };
    } catch {
      setError("Unable to connect. Please try again.");
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  async function openCase(concernId: string) {
    const result = await call(`/api/labs/pta/concerns/${concernId}`);
    if (result.ok) {
      const loaded = result.data as CaseDetail;
      setDetail(loaded);
      setStatusDraft(loaded.status);
      setResolutionDraft(loaded.resolution ?? "");
    }
  }

  async function reloadDetail(concernId: string) {
    const result = await call(`/api/labs/pta/concerns/${concernId}`);
    if (result.ok) setDetail(result.data as CaseDetail);
  }

  async function createCase() {
    const result = await call("/api/labs/pta/concerns", {
      method: "POST",
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        category,
        isRestricted,
        reporterName: reporterName.trim() || null,
        reporterContact: reporterContact.trim() || null,
        subjectName: subjectName.trim() || null,
        incidentDate: incidentDate || null,
        responseDeadline: responseDeadline || null,
        assignedCommitteeId: committeeId || null,
        applicableGovernanceDocumentId: governanceId || null,
      }),
    });
    if (result.ok) {
      setShowCreate(false);
      setTitle("");
      setDescription("");
      setCategory("OTHER");
      setIsRestricted(false);
      setReporterName("");
      setReporterContact("");
      setSubjectName("");
      setIncidentDate("");
      setResponseDeadline("");
      setCommitteeId("");
      setGovernanceId("");
      router.refresh();
    }
  }

  async function saveStatus() {
    if (!detail) return;
    const movingToResolution = statusDraft === "RESOLVED" || statusDraft === "DISMISSED";
    const result = await call(`/api/labs/pta/concerns/${detail.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: statusDraft,
        ...(movingToResolution ? { resolution: resolutionDraft.trim() || null } : {}),
      }),
    });
    if (result.ok) {
      await reloadDetail(detail.id);
      router.refresh();
    }
  }

  async function addNote() {
    if (!detail) return;
    const result = await call(`/api/labs/pta/concerns/${detail.id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: noteDraft.trim(), kind: noteKind }),
    });
    if (result.ok) {
      setNoteDraft("");
      await reloadDetail(detail.id);
      router.refresh();
    }
  }

  async function assignOfficer() {
    if (!detail || !assignUserId) return;
    const result = await call(`/api/labs/pta/concerns/${detail.id}/assignees`, {
      method: "POST",
      body: JSON.stringify({ userId: assignUserId }),
    });
    if (result.ok) {
      setAssignUserId("");
      await reloadDetail(detail.id);
      router.refresh();
    }
  }

  async function removeOfficer(userId: string) {
    if (!detail) return;
    const result = await call(`/api/labs/pta/concerns/${detail.id}/assignees`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    });
    if (result.ok) {
      await reloadDetail(detail.id);
      router.refresh();
    }
  }

  async function reassignRestricted(concernId: string) {
    if (!assignUserId) return;
    const result = await call(`/api/labs/pta/concerns/${concernId}/assignees`, {
      method: "POST",
      body: JSON.stringify({ userId: assignUserId }),
    });
    if (result.ok) {
      setAssignUserId("");
      router.refresh();
    }
  }

  const inputClass =
    "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

  return (
    <div className="space-y-6">
      {viewer.canManage ? (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={() => setShowCreate((value) => !value)}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {showCreate ? "Cancel" : "Record a new case"}
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>Case title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900 sm:col-span-2">
              <span>What happened</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
                {Object.entries(CATEGORY_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm font-medium text-slate-900">
              <input type="checkbox" checked={isRestricted} onChange={(event) => setIsRestricted(event.target.checked)} className="h-4 w-4" />
              <span>
                Restricted case
                <span className="block text-xs font-normal text-slate-500">Only officers you explicitly assign can read it — including you, automatically.</span>
              </span>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Reported by (optional)</span>
              <input value={reporterName} onChange={(event) => setReporterName(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Reporter contact (optional)</span>
              <input value={reporterContact} onChange={(event) => setReporterContact(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Concerns (person/vendor, optional)</span>
              <input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Incident date (optional)</span>
              <input type="date" value={incidentDate} onChange={(event) => setIncidentDate(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Response due (optional)</span>
              <input type="date" value={responseDeadline} onChange={(event) => setResponseDeadline(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Referred to committee (optional)</span>
              <select value={committeeId} onChange={(event) => setCommitteeId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {committees.map((committee) => (
                  <option key={committee.id} value={committee.id}>
                    {committee.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-900">
              <span>Governing document that applies (optional)</span>
              <select value={governanceId} onChange={(event) => setGovernanceId(event.target.value)} className={inputClass}>
                <option value="">—</option>
                {governanceDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={pending || !title.trim() || !description.trim()}
            onClick={createCase}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            Record case
          </button>
        </div>
      ) : null}

      {cases.length === 0 && redactedCases.length === 0 ? (
        <p className="text-sm text-slate-600">No cases recorded. {featureLabel} entries appear here as your board records them.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Case</th>
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Submitted</th>
                <th className="py-2 pr-4">Response due</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cases.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-700">{row.caseNumber}</td>
                  <td className="py-2 pr-4 font-medium text-slate-900">
                    {row.title}
                    {row.isRestricted ? (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Restricted</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{CATEGORY_LABELS[row.category] ?? row.category}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{formatDate(row.submittedAt)}</td>
                  <td className="py-2 pr-4 text-slate-700">{formatDate(row.responseDeadline)}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => openCase(row.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {redactedCases.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-4">
          <h3 className="text-sm font-semibold text-red-900">Restricted cases you are not assigned to</h3>
          <p className="text-xs text-red-800">
            You can see these exist (so assignments can be fixed) but cannot read their contents. Assign an officer — or yourself, if appropriate — to give someone access.
          </p>
          <ul className="divide-y divide-red-100">
            {redactedCases.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="font-mono text-xs text-red-900">{row.caseNumber}</span>
                <span className="text-red-900">{CATEGORY_LABELS[row.category] ?? row.category}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
                <span className="text-red-800">{formatDate(row.submittedAt)}</span>
                {viewer.canAssign ? (
                  <span className="flex items-center gap-2">
                    <select value={assignUserId} onChange={(event) => setAssignUserId(event.target.value)} className={inputClass + " w-56"}>
                      <option value="">Choose an officer…</option>
                      {officers.map((officer) => (
                        <option key={officer.userId} value={officer.userId}>
                          {officer.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !assignUserId}
                      onClick={() => reassignRestricted(row.id)}
                      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50"
                    >
                      Assign
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail ? (
        <div className="space-y-4 rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                <span className="mr-2 font-mono text-sm text-slate-500">{detail.caseNumber}</span>
                {detail.title}
                {detail.isRestricted ? (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Restricted</span>
                ) : null}
              </h3>
              <p className="text-xs text-slate-500">
                {CATEGORY_LABELS[detail.category] ?? detail.category} · submitted {formatDate(detail.submittedAt)}
                {detail.assignedCommittee ? ` · referred to ${detail.assignedCommittee.name}` : ""}
                {detail.applicableGovernance ? ` · governed by ${detail.applicableGovernance.title} (v${detail.applicableGovernance.version})` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          <p className="whitespace-pre-wrap text-sm text-slate-800">{detail.description}</p>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reported by</dt>
              <dd className="text-slate-800">{detail.reporterName ?? "Not recorded"}{detail.reporterContact ? ` (${detail.reporterContact})` : ""}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Concerns</dt>
              <dd className="text-slate-800">{detail.subjectName ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident date</dt>
              <dd className="text-slate-800">{formatDate(detail.incidentDate)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Response due</dt>
              <dd className="text-slate-800">{formatDate(detail.responseDeadline)}</dd>
            </div>
          </dl>

          {detail.resolution ? (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Resolution{detail.resolvedAt ? ` · ${formatDate(detail.resolvedAt)}` : ""}</p>
              <p className="whitespace-pre-wrap text-emerald-900">{detail.resolution}</p>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h4 className="text-sm font-semibold text-slate-900">Assigned officers</h4>
            {detail.assignees.length === 0 ? (
              <p className="text-sm text-slate-600">No officers assigned.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {detail.assignees.map((assignee) => (
                  <li key={assignee.userId} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">
                    {assignee.user.displayName || assignee.user.email}
                    {viewer.canAssign ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => removeOfficer(assignee.userId)}
                        className="text-xs font-semibold text-slate-500 hover:text-red-700 disabled:opacity-50"
                        aria-label="Remove assignment"
                      >
                        ✕
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {viewer.canAssign ? (
              <div className="flex flex-wrap items-center gap-2">
                <select value={assignUserId} onChange={(event) => setAssignUserId(event.target.value)} className={inputClass + " w-64"}>
                  <option value="">Assign an officer…</option>
                  {officers
                    .filter((officer) => !detail.assignees.some((assignee) => assignee.userId === officer.userId))
                    .map((officer) => (
                      <option key={officer.userId} value={officer.userId}>
                        {officer.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={pending || !assignUserId}
                  onClick={assignOfficer}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h4 className="text-sm font-semibold text-slate-900">Status</h4>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-sm font-medium text-slate-900">
                <span>Move to</span>
                <select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)} className={inputClass + " w-56"}>
                  {Object.entries(STATUS_LABELS).map(([value, text]) => (
                    <option key={value} value={value} disabled={(value === "RESOLVED" || value === "DISMISSED") && !viewer.canResolve}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={pending || statusDraft === detail.status}
                onClick={saveStatus}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Update status
              </button>
            </div>
            {statusDraft === "RESOLVED" || statusDraft === "DISMISSED" ? (
              <label className="block space-y-1 text-sm font-medium text-slate-900">
                <span>Resolution summary (required)</span>
                <textarea value={resolutionDraft} onChange={(event) => setResolutionDraft(event.target.value)} rows={3} className={inputClass} />
              </label>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h4 className="text-sm font-semibold text-slate-900">Case log</h4>
            {detail.notes.length === 0 ? (
              <p className="text-sm text-slate-600">No entries yet.</p>
            ) : (
              <ul className="space-y-2">
                {detail.notes.map((note) => (
                  <li key={note.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="text-xs text-slate-500">
                      {NOTE_KIND_LABELS[note.kind] ?? note.kind} · {note.author?.displayName || note.author?.email || "Unknown"} · {formatDate(note.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap text-slate-800">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <select value={noteKind} onChange={(event) => setNoteKind(event.target.value)} className={inputClass + " w-48"}>
                  {Object.entries(NOTE_KIND_LABELS).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
                <textarea
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  rows={2}
                  placeholder="Add to the case log — entries cannot be edited or deleted later."
                  className={inputClass + " flex-1"}
                />
              </div>
              <button
                type="button"
                disabled={pending || !noteDraft.trim()}
                onClick={addNote}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                Add entry
              </button>
            </div>
          </div>
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
