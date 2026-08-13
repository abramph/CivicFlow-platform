"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MinutesStatus = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "SUPERSEDED";

type MinutesVersion = {
  id: string;
  version: number;
  status: MinutesStatus;
  title: string;
  bodyText: string;
  changesRequestedReason: string | null;
  approvedAt: string | null;
};

const STATUS_LABELS: Record<MinutesStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  CHANGES_REQUESTED: "Changes Requested",
  APPROVED: "Approved",
  SUPERSEDED: "Superseded",
};

const STATUS_STYLES: Record<MinutesStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-800",
  IN_REVIEW: "bg-amber-100 text-amber-800",
  CHANGES_REQUESTED: "bg-red-100 text-red-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  SUPERSEDED: "bg-slate-100 text-slate-500",
};

const fieldClassName =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export function MeetingMinutesPanel({
  meetingId,
  versions,
  canWrite,
  canReview,
  canApprove,
}: {
  meetingId: string;
  versions: MinutesVersion[];
  canWrite: boolean;
  canReview: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const latest = versions[0] ?? null;
  const isDraftable = !latest || latest.status === "APPROVED" || latest.status === "SUPERSEDED";
  const isEditable = latest ? (latest.status === "DRAFT" || latest.status === "CHANGES_REQUESTED") : false;

  const [title, setTitle] = useState(isEditable && latest ? latest.title : "");
  const [bodyText, setBodyText] = useState(isEditable && latest ? latest.bodyText : "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(url: string, method: "POST" | "PATCH", body?: object) {
    setError(null);
    setPending(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function handleSaveDraft() {
    if (isDraftable) {
      void submit(`/api/meetings/${meetingId}/minutes`, "POST", { title, bodyText });
    } else if (latest) {
      void submit(`/api/meetings/${meetingId}/minutes/${latest.id}`, "PATCH", { title, bodyText });
    }
  }

  function handleSubmitForReview() {
    if (latest) void submit(`/api/meetings/${meetingId}/minutes/${latest.id}/submit`, "POST");
  }

  function handleRequestChanges() {
    if (latest && reason.trim().length >= 3) {
      void submit(`/api/meetings/${meetingId}/minutes/${latest.id}/request-changes`, "POST", { reason: reason.trim() });
    }
  }

  function handleApprove() {
    if (latest) void submit(`/api/meetings/${meetingId}/minutes/${latest.id}/approve`, "POST");
  }

  return (
    <div className="space-y-4">
      {latest ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[latest.status]}`}>
            {STATUS_LABELS[latest.status]}
          </span>
          <span className="text-slate-600">Version {latest.version}</span>
          {latest.status === "APPROVED" && latest.approvedAt ? (
            <span className="text-slate-600">· Approved {new Date(latest.approvedAt).toLocaleDateString()}</span>
          ) : null}
          {latest.status === "APPROVED" || latest.status === "SUPERSEDED" ? (
            <a
              href={`/api/meetings/${meetingId}/minutes/${latest.id}/pdf`}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-50"
            >
              Download PDF
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-600">No minutes have been drafted for this meeting yet.</p>
      )}

      {latest?.status === "CHANGES_REQUESTED" && latest.changesRequestedReason ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-semibold">Changes requested:</p>
          <p className="mt-1 whitespace-pre-wrap">{latest.changesRequestedReason}</p>
        </div>
      ) : null}

      {isEditable || isDraftable ? (
        canWrite ? (
          <div className="space-y-3">
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Title</span>
              <input className={fieldClassName} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Board Meeting Minutes" />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-900">
              <span>Minutes</span>
              <textarea className={fieldClassName} rows={10} value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Called to order at..." />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending || !title.trim() || !bodyText.trim()}
                onClick={handleSaveDraft}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save Draft
              </button>
              {!isDraftable ? (
                <button
                  type="button"
                  disabled={pending || !title.trim() || !bodyText.trim()}
                  onClick={handleSubmitForReview}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Submit for Review
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">You do not have permission to draft minutes for this meeting.</p>
        )
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">{latest?.title}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{latest?.bodyText}</p>
        </div>
      )}

      {latest?.status === "IN_REVIEW" ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-950">Awaiting review</p>
          {canReview ? (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm font-medium text-slate-900">
                <span>Reason for requesting changes</span>
                <textarea className={fieldClassName} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What needs to change?" />
              </label>
              <button
                type="button"
                disabled={pending || reason.trim().length < 3}
                onClick={handleRequestChanges}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Request Changes
              </button>
            </div>
          ) : null}
          {canApprove ? (
            <button
              type="button"
              disabled={pending}
              onClick={handleApprove}
              className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Approve Minutes
            </button>
          ) : null}
          {!canReview && !canApprove ? <p className="text-sm text-amber-900">You do not have review or approval authority for meeting minutes.</p> : null}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {versions.length > 1 ? (
        <details className="rounded-lg border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-slate-900">Version history ({versions.length})</summary>
          <ul className="mt-2 space-y-1">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center gap-2 text-slate-700">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[v.status]}`}>{STATUS_LABELS[v.status]}</span>
                <span>Version {v.version}</span>
                {v.approvedAt ? <span className="text-slate-500">· Approved {new Date(v.approvedAt).toLocaleDateString()}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
