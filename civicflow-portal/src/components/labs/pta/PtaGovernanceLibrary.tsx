"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface GovernanceVersion {
  id: string;
  version: number;
  status: "DRAFT" | "CURRENT" | "SUPERSEDED" | "ARCHIVED";
  effectiveDate: string | null;
  approvedDate: string | null;
  reviewDate: string | null;
  fileName: string | null;
  notes: string | null;
}

interface GovernanceGroup {
  groupId: string;
  docType: string;
  title: string;
  current: GovernanceVersion | null;
  versions: GovernanceVersion[];
}

const DOC_TYPE_LABELS: Record<string, string> = {
  BYLAWS: "Bylaws",
  STANDING_RULES: "Standing Rules",
  POLICY: "Policy",
  PROCEDURE: "Procedure",
  CONFLICT_OF_INTEREST: "Conflict of Interest Policy",
  FINANCIAL_PROCEDURES: "Financial Procedures",
  ELECTION_RULES: "Election Rules",
  CODE_OF_CONDUCT: "Code of Conduct",
  RESOLUTION: "Resolution",
  OTHER: "Other",
};

const STATUS_BADGES: Record<GovernanceVersion["status"], string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  CURRENT: "bg-emerald-100 text-emerald-800",
  SUPERSEDED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-slate-100 text-slate-500",
};

/**
 * PTA Vertical 2.0, PR PTA-D — "Bylaws & Policies". Upload governing
 * documents, publish a version as current (the previous current is
 * superseded automatically, never deleted), amend with new versions, and
 * browse the full amendment history.
 */
export function PtaGovernanceLibrary({ groups, canWrite }: { groups: GovernanceGroup[]; canWrite: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("BYLAWS");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [makeCurrent, setMakeCurrent] = useState(true);
  const [amendGroupId, setAmendGroupId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function upload() {
    setPending(true);
    setError(null);
    try {
      const formData = new FormData();
      const amending = groups.find((group) => group.groupId === amendGroupId) ?? null;
      formData.set("title", amending ? amending.title : title.trim());
      formData.set("docType", amending ? amending.docType : docType);
      if (amending) formData.set("rootDocumentId", amending.groupId);
      if (effectiveDate) formData.set("effectiveDate", effectiveDate);
      formData.set("makeCurrent", String(makeCurrent));
      if (file) formData.set("file", file);
      const res = await fetch("/api/governance-documents", { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return;
      }
      setTitle("");
      setFile(null);
      setAmendGroupId("");
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function setStatus(documentId: string, status: "CURRENT" | "ARCHIVED" | "DRAFT") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/governance-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Unable to save.");
        return;
      }
      router.refresh();
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  const smallButton = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <p className="text-sm text-slate-600">
          No governing documents yet{canWrite ? " — add your bylaws below to get started." : "."}
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.groupId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{group.title}</p>
                  <p className="text-xs text-slate-600">
                    {DOC_TYPE_LABELS[group.docType] ?? group.docType}
                    {group.current
                      ? ` · current: v${group.current.version}${group.current.effectiveDate ? ` (effective ${new Date(group.current.effectiveDate).toLocaleDateString()})` : ""}`
                      : " · no current version"}
                  </p>
                </div>
                <div className="flex gap-2">
                  {group.current?.fileName ? (
                    <a href={`/api/governance-documents/${group.current.id}/download`} className={smallButton}>
                      Download current
                    </a>
                  ) : null}
                  <button type="button" disabled={pending} onClick={() => setExpanded(expanded === group.groupId ? null : group.groupId)} className={smallButton}>
                    {expanded === group.groupId ? "Hide versions" : `Versions (${group.versions.length})`}
                  </button>
                </div>
              </div>
              {expanded === group.groupId ? (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                  {group.versions.map((version) => (
                    <li key={version.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-800">
                        v{version.version}
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGES[version.status]}`}>
                          {version.status.toLowerCase()}
                        </span>
                        {version.fileName ? <span className="ml-2 text-xs text-slate-500">{version.fileName}</span> : null}
                      </span>
                      <span className="flex gap-2">
                        {version.fileName ? (
                          <a href={`/api/governance-documents/${version.id}/download`} className={smallButton}>
                            Download
                          </a>
                        ) : null}
                        {canWrite && version.status === "DRAFT" ? (
                          <button type="button" disabled={pending} onClick={() => setStatus(version.id, "CURRENT")} className={smallButton}>
                            Publish as current
                          </button>
                        ) : null}
                        {canWrite && version.status !== "ARCHIVED" && version.status !== "CURRENT" ? (
                          <button type="button" disabled={pending} onClick={() => setStatus(version.id, "ARCHIVED")} className={smallButton}>
                            Archive
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-sm font-semibold text-slate-900">{amendGroupId ? "Add a new version" : "Add a governing document"}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs font-medium text-slate-700">
              <span>Amend existing</span>
              <select value={amendGroupId} onChange={(event) => setAmendGroupId(event.target.value)} className={inputClass}>
                <option value="">— new document —</option>
                {groups.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.title}
                  </option>
                ))}
              </select>
            </label>
            {!amendGroupId ? (
              <>
                <label className="space-y-1 text-xs font-medium text-slate-700">
                  <span>Title</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Unestra Demo PTA Bylaws" className={`${inputClass} w-64`} />
                </label>
                <label className="space-y-1 text-xs font-medium text-slate-700">
                  <span>Type</span>
                  <select value={docType} onChange={(event) => setDocType(event.target.value)} className={inputClass}>
                    {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="space-y-1 text-xs font-medium text-slate-700">
              <span>Effective date</span>
              <input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-1 text-xs font-medium text-slate-700">
              <span>File (optional, 15 MB max)</span>
              <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block text-sm" />
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-700">
              <input type="checkbox" checked={makeCurrent} onChange={(event) => setMakeCurrent(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
              <span>Publish as current</span>
            </label>
            <button
              type="button"
              disabled={pending || (!amendGroupId && !title.trim())}
              onClick={upload}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              Save
            </button>
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
